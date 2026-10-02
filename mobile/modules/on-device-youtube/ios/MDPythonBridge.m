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
static const NSUInteger mdJSMemoryLimit = 192 * 1024 * 1024;
static const NSUInteger mdJSStackLimit = 2 * 1024 * 1024;
static const NSUInteger mdJSScriptLimit = 16 * 1024 * 1024;
static const NSUInteger mdJSOutputLimit = 8 * 1024 * 1024;
static const double mdJSTimeoutSeconds = 25;
static NSString *mdLastJSDiagnostics = @"{}";

typedef struct {
  double deadline;
  BOOL timedOut;
  BOOL cancelled;
} MDJSInterruptState;

static double mdNow(void) {
  struct timespec value;
  clock_gettime(CLOCK_MONOTONIC, &value);
  return value.tv_sec + value.tv_nsec / 1e9;
}

static int mdInterrupted(void) {
  return atomic_load(&mdCancelled) || mdNow() > mdDeadline;
}

static int mdJSInterrupt(JSRuntime *runtime, void *opaque) {
  MDJSInterruptState *state = opaque;
  if (atomic_load(&mdCancelled)) {
    state->cancelled = YES;
    return 1;
  }
  if (mdNow() > state->deadline || mdNow() > mdDeadline) {
    state->timedOut = YES;
    return 1;
  }
  return 0;
}

static JSValue mdJSLog(JSContext *ctx, JSValueConst self, int argc, JSValueConst *argv) {
  NSMutableDictionary *state = (__bridge NSMutableDictionary *)JS_GetContextOpaque(ctx);
  NSMutableString *capture = state[@"capture"];
  state[@"consoleCalls"] = @([state[@"consoleCalls"] unsignedIntegerValue] + 1);
  for (int i = 0; i < argc; i++) {
    size_t length;
    const char *text = JS_ToCStringLen(ctx, &length, argv[i]);
    if (!text) {
      state[@"captureError"] = @"UTF8_CONVERSION_FAILED";
      return JS_EXCEPTION;
    }
    NSUInteger separatorLength = i > 0 ? 1 : 0;
    NSUInteger capturedBytes = [capture lengthOfBytesUsingEncoding:NSUTF8StringEncoding];
    if (length > mdJSOutputLimit || capturedBytes + separatorLength + length + 1 > mdJSOutputLimit) {
      JS_FreeCString(ctx, text);
      state[@"captureError"] = @"OUTPUT_LIMIT";
      return JS_ThrowRangeError(ctx, "JS output limit exceeded");
    }
    if (i > 0) [capture appendString:@" "];
    [capture appendString:[[NSString alloc] initWithBytes:text length:length encoding:NSUTF8StringEncoding] ?: @""];
    JS_FreeCString(ctx, text);
  }
  [capture appendString:@"\n"];
  return JS_UNDEFINED;
}

static NSString *mdJSSafeString(JSContext *ctx, JSValueConst value, NSUInteger limit) {
  const char *raw = JS_ToCString(ctx, value);
  if (!raw) return nil;
  NSString *text = [NSString stringWithUTF8String:raw] ?: @"";
  JS_FreeCString(ctx, raw);
  NSRegularExpression *urls = [NSRegularExpression regularExpressionWithPattern:@"https?://[^\\s\\\"']+" options:0 error:nil];
  text = [urls stringByReplacingMatchesInString:text options:0 range:NSMakeRange(0, text.length) withTemplate:@"<url>"];
  return text.length > limit ? [[text substringToIndex:limit] stringByAppendingString:@"…"] : text;
}

static void mdStoreJSDiagnostics(NSDictionary *diagnostics) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:diagnostics options:0 error:nil];
  mdLastJSDiagnostics = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

static PyObject *mdRunJS(PyObject *self, PyObject *args) {
  const char *script;
  Py_ssize_t length;
  if (!PyArg_ParseTuple(args, "s#", &script, &length)) return NULL;
  double started = mdNow();
  NSMutableDictionary *diagnostics = [@{
    @"scriptBytes": @(length),
    @"memoryLimitBytes": @(mdJSMemoryLimit),
    @"stackLimitBytes": @(mdJSStackLimit),
    @"timeoutSeconds": @(mdJSTimeoutSeconds),
    @"outputLimitBytes": @(mdJSOutputLimit),
    @"capturedBytes": @0,
    @"consoleCalls": @0,
    @"interrupted": @NO,
    @"timedOut": @NO,
    @"cancelled": @NO,
    @"completedNormally": @NO,
  } mutableCopy];
  if (length > mdJSScriptLimit || mdInterrupted()) {
    NSString *code = length > mdJSScriptLimit ? @"LOCAL_JS_SCRIPT_LIMIT" : @"LOCAL_CANCELLED";
    diagnostics[@"errorCode"] = code;
    diagnostics[@"elapsedSeconds"] = @(mdNow() - started);
    mdStoreJSDiagnostics(diagnostics);
    PyErr_SetString(PyExc_RuntimeError, code.UTF8String);
    return NULL;
  }
  JSRuntime *runtime = JS_NewRuntime();
  if (!runtime) {
    diagnostics[@"errorCode"] = @"LOCAL_JS_RUNTIME_ALLOCATION_FAILED";
    diagnostics[@"elapsedSeconds"] = @(mdNow() - started);
    mdStoreJSDiagnostics(diagnostics);
    return PyErr_NoMemory();
  }
  JS_SetMemoryLimit(runtime, mdJSMemoryLimit);
  JS_SetMaxStackSize(runtime, mdJSStackLimit);
  MDJSInterruptState interrupt = {
    .deadline = mdNow() + mdJSTimeoutSeconds,
    .timedOut = NO,
    .cancelled = NO,
  };
  JS_SetInterruptHandler(runtime, mdJSInterrupt, &interrupt);
  JSContext *ctx = JS_NewContext(runtime);
  if (!ctx) {
    diagnostics[@"errorCode"] = @"LOCAL_JS_CONTEXT_ALLOCATION_FAILED";
    diagnostics[@"elapsedSeconds"] = @(mdNow() - started);
    mdStoreJSDiagnostics(diagnostics);
    JS_FreeRuntime(runtime);
    return PyErr_NoMemory();
  }
  NSMutableString *capture = [NSMutableString string];
  NSMutableDictionary *captureState = [@{
    @"capture": capture,
    @"consoleCalls": @0,
  } mutableCopy];
  JS_SetContextOpaque(ctx, (__bridge void *)captureState);
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue console = JS_NewObject(ctx);
  int logResult = JS_SetPropertyStr(ctx, console, "log", JS_NewCFunction(ctx, mdJSLog, "log", 1));
  int consoleResult = JS_SetPropertyStr(ctx, global, "console", console);
  JS_FreeValue(ctx, global);
  if (logResult < 0 || consoleResult < 0) {
    diagnostics[@"errorCode"] = @"LOCAL_JS_CONSOLE_REGISTRATION_FAILED";
    diagnostics[@"elapsedSeconds"] = @(mdNow() - started);
    mdStoreJSDiagnostics(diagnostics);
    JS_FreeContext(ctx);
    JS_FreeRuntime(runtime);
    PyErr_SetString(PyExc_RuntimeError, "LOCAL_JS_CONSOLE_REGISTRATION_FAILED");
    return NULL;
  }
  // No QuickJS libc, module loader, filesystem, network, process API or JIT.
  JSValue result = JS_Eval(ctx, script, length, "mediadrop-ejs.js", JS_EVAL_TYPE_GLOBAL);
  BOOL failed = JS_IsException(result);
  NSString *failureCode = @"LOCAL_JS_EVAL_FAILED";
  NSString *exceptionName = nil;
  NSString *exceptionMessage = nil;
  NSString *exceptionStack = nil;
  if (failed) {
    JSValue error = JS_GetException(ctx);
    if (JS_IsObject(error)) {
      JSValue nameValue = JS_GetPropertyStr(ctx, error, "name");
      JSValue messageValue = JS_GetPropertyStr(ctx, error, "message");
      JSValue stackValue = JS_GetPropertyStr(ctx, error, "stack");
      exceptionName = mdJSSafeString(ctx, nameValue, 80);
      exceptionMessage = mdJSSafeString(ctx, messageValue, 300);
      exceptionStack = mdJSSafeString(ctx, stackValue, 1000);
      JS_FreeValue(ctx, nameValue);
      JS_FreeValue(ctx, messageValue);
      JS_FreeValue(ctx, stackValue);
    } else {
      exceptionMessage = mdJSSafeString(ctx, error, 300);
    }
    NSString *lowerMessage = exceptionMessage.lowercaseString ?: @"";
    if ([captureState[@"captureError"] isEqual:@"OUTPUT_LIMIT"] || [lowerMessage containsString:@"output limit exceeded"]) {
      failureCode = @"LOCAL_JS_OUTPUT_LIMIT";
    } else if ([lowerMessage containsString:@"out of memory"] || JS_IsNull(error) || JS_IsUndefined(error)) {
      failureCode = @"LOCAL_JS_MEMORY_LIMIT";
    } else if ([lowerMessage containsString:@"stack overflow"]) {
      failureCode = @"LOCAL_JS_STACK_LIMIT";
    }
    JS_FreeValue(ctx, error);
  }
  JSMemoryUsage memoryUsage;
  JS_ComputeMemoryUsage(runtime, &memoryUsage);
  diagnostics[@"capturedBytes"] = @([capture lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);
  diagnostics[@"consoleCalls"] = captureState[@"consoleCalls"];
  diagnostics[@"quickJsMallocBytes"] = @(memoryUsage.malloc_size);
  diagnostics[@"quickJsMemoryUsedBytes"] = @(memoryUsage.memory_used_size);
  diagnostics[@"interrupted"] = @(interrupt.timedOut || interrupt.cancelled);
  diagnostics[@"timedOut"] = @(interrupt.timedOut);
  diagnostics[@"cancelled"] = @(interrupt.cancelled);
  diagnostics[@"completedNormally"] = @(!failed && !interrupt.timedOut && !interrupt.cancelled);
  diagnostics[@"elapsedSeconds"] = @(mdNow() - started);
  if (captureState[@"captureError"]) diagnostics[@"captureError"] = captureState[@"captureError"];
  if (exceptionName.length) diagnostics[@"exceptionName"] = exceptionName;
  if (exceptionMessage.length) diagnostics[@"exceptionMessage"] = exceptionMessage;
  if (exceptionStack.length) diagnostics[@"exceptionStack"] = exceptionStack;
  if (failed || interrupt.timedOut || interrupt.cancelled) diagnostics[@"errorCode"] = failureCode;
  mdStoreJSDiagnostics(diagnostics);
  JS_FreeValue(ctx, result);
  JS_FreeContext(ctx);
  JS_FreeRuntime(runtime);
  if (failed || interrupt.timedOut || interrupt.cancelled) {
    NSString *code = interrupt.cancelled ? @"LOCAL_CANCELLED" : (interrupt.timedOut ? @"LOCAL_JS_TIMEOUT" : failureCode);
    PyErr_SetString(PyExc_RuntimeError, code.UTF8String);
    return NULL;
  }
  return PyUnicode_FromString(capture.UTF8String);
}

static PyObject *mdGetJSDiagnostics(PyObject *self, PyObject *args) {
  return PyUnicode_FromString(mdLastJSDiagnostics.UTF8String);
}

static PyObject *mdCheck(PyObject *self, PyObject *args) {
  if (mdInterrupted()) { PyErr_SetString(PyExc_RuntimeError, "LOCAL_CANCELLED"); return NULL; }
  Py_RETURN_NONE;
}

static PyMethodDef mdMethods[] = {
  {"run_js", mdRunJS, METH_VARARGS, NULL},
  {"get_js_diagnostics", mdGetJSDiagnostics, METH_NOARGS, NULL},
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

+ (void)invokePythonMethod:(NSString *)method
                  argument:(NSString * _Nullable)argument
            timeoutSeconds:(NSTimeInterval)timeoutSeconds
                completion:(void (^)(NSString *))completion {
  if (atomic_exchange(&mdBusy, true)) {
    completion(@"{\"error\":{\"code\":\"LOCAL_BUSY\"}}");
    return;
  }
  atomic_store(&mdCancelled, false);
  mdDeadline = mdNow() + MIN(100.0, MAX(0.0, timeoutSeconds));
  NSThread *thread = [[NSThread alloc] initWithBlock:^{
    @autoreleasepool {
      NSString *json = @"{\"error\":{\"code\":\"LOCAL_RUNTIME_FAILED\"}}";
      if (mdInitialize()) {
        PyGILState_STATE gil = PyGILState_Ensure();
        PyObject *module = PyImport_ImportModule("mediadrop_spike");
        if (module) {
          PyObject *callable = PyObject_GetAttrString(module, method.UTF8String);
          PyObject *result = callable
            ? (argument
                ? PyObject_CallFunction(callable, "s", argument.UTF8String)
                : PyObject_CallNoArgs(callable))
            : NULL;
          if (result && PyUnicode_Check(result)) {
            const char *text = PyUnicode_AsUTF8(result);
            if (text) json = [NSString stringWithUTF8String:text];
          }
          Py_XDECREF(result);
          Py_XDECREF(callable);
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
  thread.name = [@"MediaDrop.YouTube." stringByAppendingString:method];
  thread.stackSize = 8 * 1024 * 1024;
  [thread start];
}

+ (void)analyze:(NSString *)url completion:(void (^)(NSString *))completion {
  [self invokePythonMethod:@"analyze" argument:url timeoutSeconds:100 completion:completion];
}

+ (void)testEJS:(void (^)(NSString *))completion {
  [self invokePythonMethod:@"run_ejs_fixture" argument:nil timeoutSeconds:100 completion:completion];
}

+ (void)prepareAudioDownload:(NSString *)analysisId
                    formatId:(NSString *)formatId
                  completion:(void (^)(NSString *))completion {
  NSDictionary *request = @{ @"analysisId": analysisId, @"formatId": formatId };
  NSData *data = [NSJSONSerialization dataWithJSONObject:request options:0 error:nil];
  NSString *argument = data
    ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
    : @"{}";
  [self invokePythonMethod:@"prepare_audio_download" argument:argument timeoutSeconds:100 completion:completion];
}

+ (void)prepareAudioDownload:(NSString *)analysisId
                    formatId:(NSString *)formatId
              timeoutSeconds:(NSTimeInterval)timeoutSeconds
                  completion:(void (^)(NSString *))completion {
  NSDictionary *request = @{ @"analysisId": analysisId, @"formatId": formatId };
  NSData *data = [NSJSONSerialization dataWithJSONObject:request options:0 error:nil];
  NSString *argument = data
    ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
    : @"{}";
  [self invokePythonMethod:@"prepare_audio_download" argument:argument
           timeoutSeconds:timeoutSeconds completion:completion];
}

+ (void)prepareVideoDownload:(NSString *)analysisId
                    formatId:(NSString *)formatId
                  completion:(void (^)(NSString *))completion {
  NSDictionary *request = @{ @"analysisId": analysisId, @"formatId": formatId };
  NSData *data = [NSJSONSerialization dataWithJSONObject:request options:0 error:nil];
  NSString *argument = data
    ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
    : @"{}";
  [self invokePythonMethod:@"prepare_video_download" argument:argument timeoutSeconds:100 completion:completion];
}
@end
