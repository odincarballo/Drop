#import "MDPythonBridge.h"
#include <Python/Python.h>
#include "quickjs.h"
#include <stdatomic.h>
#include <time.h>
#include <mach/mach.h>
#include <TargetConditionals.h>

static atomic_bool mdCancelled;
static atomic_bool mdBusy;
static double mdDeadline;
static BOOL mdInitialized = NO;

static double mdNow(void) {
  struct timespec value;
  clock_gettime(CLOCK_MONOTONIC, &value);
  return value.tv_sec + value.tv_nsec / 1e9;
}

static int mdInterrupted(void) {
  return atomic_load(&mdCancelled) || mdNow() > mdDeadline;
}

static int mdJSInterrupt(JSRuntime *runtime, void *opaque) {
  return mdInterrupted() || mdNow() > *(double *)opaque;
}

static JSValue mdJSLog(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  NSMutableString *capture = (__bridge NSMutableString *)JS_GetContextOpaque(ctx);
  for (int i = 0; i < argc; i++) {
    size_t length;
    const char *text = JS_ToCStringLen(ctx, &length, argv[i]);
    if (!text) return JS_EXCEPTION;
    if (length > 2 * 1024 * 1024 || capture.length + length > 2 * 1024 * 1024) {
      JS_FreeCString(ctx, text);
      return JS_ThrowRangeError(ctx, "JS output limit exceeded");
    }
    [capture appendString:[[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding] ?: @""];
    JS_FreeCString(ctx, text);
  }
  return JS_UNDEFINED;
}

static PyObject *mdRunJS(PyObject *self, PyObject *args) {
  const char *script;
  Py_ssize_t length;
  if (!PyArg_ParseTuple(args, "s#", &script, &length)) return NULL;
  if (length > 16 * 1024 * 1024 || mdInterrupted()) {
    PyErr_SetString(PyExc_RuntimeError, "LOCAL_RESOURCE_LIMIT");
    return NULL;
  }
  JSRuntime *runtime = JS_NewRuntime();
  if (!runtime) return PyErr_NoMemory();
  JS_SetMemoryLimit(runtime, 96 * 1024 * 1024);
  JS_SetMaxStackSize(runtime, 2 * 1024 * 1024);
  double deadline = mdNow() + 25;
  JS_SetInterruptHandler(runtime, mdJSInterrupt, &deadline);
  JSContext *ctx = JS_NewContext(runtime);
  if (!ctx) { JS_FreeRuntime(runtime); return PyErr_NoMemory(); }
  NSMutableString *capture = [NSMutableString string];
  JS_SetContextOpaque(ctx, (__bridge void *)capture);
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue console = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, console, "log", JS_NewCFunction(ctx, mdJSLog, "log", 1));
  JS_SetPropertyStr(ctx, global, "console", console);
  JS_FreeValue(ctx, global);
  // No QuickJS libc, module loader, filesystem, network, process API or JIT.
  JSValue result = JS_Eval(ctx, script, length, "mediadrop-ejs.js", JS_EVAL_TYPE_GLOBAL);
  BOOL failed = JS_IsException(result);
  if (failed) { JSValue error = JS_GetException(ctx); JS_FreeValue(ctx, error); }
  JS_FreeValue(ctx, result);
  JS_FreeContext(ctx);
  JS_FreeRuntime(runtime);
  if (failed || mdInterrupted()) {
    PyErr_SetString(PyExc_RuntimeError, mdInterrupted() ? "LOCAL_CANCELLED" : "LOCAL_JS_FAILED");
    return NULL;
  }
  return PyUnicode_FromString(capture.UTF8String);
}

static PyObject *mdCheck(PyObject *self, PyObject *args) {
  if (mdInterrupted()) { PyErr_SetString(PyExc_RuntimeError, "LOCAL_CANCELLED"); return NULL; }
  Py_RETURN_NONE;
}

static PyMethodDef mdMethods[] = {
  {"run_js", mdRunJS, METH_VARARGS, NULL},
  {"check", mdCheck, METH_NOARGS, NULL},
  {NULL, NULL, 0, NULL}
};
static struct PyModuleDef mdModule = {PyModuleDef_HEAD_INIT, "_mediadrop_native", NULL, -1, mdMethods};
PyMODINIT_FUNC PyInit__mediadrop_native(void) { return PyModule_Create(&mdModule); }

static BOOL mdInitialize(void) {
  if (mdInitialized) return YES;
  if (PyImport_AppendInittab("_mediadrop_native", PyInit__mediadrop_native) == -1) return NO;
  PyPreConfig pre;
  PyPreConfig_InitIsolatedConfig(&pre);
  pre.utf8_mode = 1;
  if (PyStatus_Exception(Py_PreInitialize(&pre))) return NO;
  PyConfig config;
  PyConfig_InitIsolatedConfig(&config);
  config.write_bytecode = 0;
  config.buffered_stdio = 0;
  config.install_signal_handlers = 0;
  config.configure_c_stdio = 0;
  NSString *bundle = NSBundle.mainBundle.resourcePath;
  PyStatus status = PyConfig_SetBytesString(&config, &config.home, [bundle stringByAppendingPathComponent:@"python"].UTF8String);
  if (PyStatus_Exception(status)) { PyConfig_Clear(&config); return NO; }
  NSArray<NSString *> *paths = @[@"python/lib/python3.13", @"python/lib/python3.13/lib-dynload", @"md_python", @"md_packages"];
  for (NSString *relative in paths) {
    wchar_t *value = Py_DecodeLocale([bundle stringByAppendingPathComponent:relative].UTF8String, NULL);
    if (!value) { PyConfig_Clear(&config); return NO; }
    status = PyWideStringList_Append(&config.module_search_paths, value);
    PyMem_RawFree(value);
    if (PyStatus_Exception(status)) { PyConfig_Clear(&config); return NO; }
  }
  config.module_search_paths_set = 1;
  status = Py_InitializeFromConfig(&config);
  PyConfig_Clear(&config);
  if (PyStatus_Exception(status)) return NO;
  mdInitialized = YES;
  PyEval_SaveThread();
  return YES;
}

@implementation MDPythonBridge
+ (void)cancel { atomic_store(&mdCancelled, true); }

+ (void)analyze:(NSString *)url completion:(void (^)(NSString *))completion {
  if (atomic_exchange(&mdBusy, true)) {
    completion(@"{\"error\":{\"code\":\"LOCAL_BUSY\"}}");
    return;
  }
  atomic_store(&mdCancelled, false);
  mdDeadline = mdNow() + 100;
  NSThread *thread = [[NSThread alloc] initWithBlock:^{
    @autoreleasepool {
      NSString *json = @"{\"error\":{\"code\":\"LOCAL_RUNTIME_FAILED\"}}";
      if (mdInitialize()) {
        PyGILState_STATE gil = PyGILState_Ensure();
        PyObject *module = PyImport_ImportModule("mediadrop_spike");
        if (module) {
          PyObject *result = PyObject_CallMethod(module, "analyze", "s", url.UTF8String);
          if (result && PyUnicode_Check(result)) {
            const char *text = PyUnicode_AsUTF8(result);
            if (text) json = [NSString stringWithUTF8String:text];
          }
          Py_XDECREF(result);
          Py_DECREF(module);
        }
        if (PyErr_Occurred()) {
          // Expose only exception class; never Python exception messages/tracebacks.
          PyObject *error = PyErr_GetRaisedException();
          const char *kind = error ? Py_TYPE(error)->tp_name : "PythonError";
          json = [NSString stringWithFormat:@"{\"error\":{\"code\":\"LOCAL_RUNTIME_FAILED\"},\"exceptionType\":\"%s\"}", kind];
          Py_XDECREF(error);
        }
        PyGILState_Release(gil);
      }
      NSMutableDictionary *envelope = [[NSJSONSerialization JSONObjectWithData:[json dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingMutableContainers error:nil] mutableCopy];
      if (envelope) {
        mach_task_basic_info_data_t info;
        mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
        if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) == KERN_SUCCESS) {
          envelope[@"residentBytes"] = @(info.resident_size);
        }
        envelope[@"deviceRuntime"] = TARGET_OS_SIMULATOR ? @"ios-simulator" : @"ios-device";
        envelope[@"engine"] = @"CPython 3.13.15 / yt-dlp 2026.08.19 / QuickJS-NG 0.16.2";
        NSData *data = [NSJSONSerialization dataWithJSONObject:envelope options:0 error:nil];
        if (data) json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      }
      atomic_store(&mdBusy, false);
      completion(json);
    }
  }];
  thread.name = @"MediaDrop.YouTube.Metadata";
  thread.stackSize = 8 * 1024 * 1024;
  [thread start];
}
@end
