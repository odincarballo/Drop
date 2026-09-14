#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface MDPythonBridge : NSObject
+ (void)analyze:(NSString *)url completion:(void (^)(NSString *))completion;
+ (void)testEJS:(void (^)(NSString *))completion;
+ (void)cancel;
@end
NS_ASSUME_NONNULL_END
