import Foundation

@main
enum DropArtworkPolicyTests {
  static func main() {
    guard DropArtworkPolicy.permitted(URL(string: "https://i.ytimg.com/vi/abc/default.jpg")!),
          !DropArtworkPolicy.permitted(URL(string: "http://i.ytimg.com/vi/abc/default.jpg")!),
          !DropArtworkPolicy.permitted(URL(string: "https://i.ytimg.com/vi/abc/default.jpg?token=secret")!),
          !DropArtworkPolicy.permitted(URL(string: "https://ytimg.com.evil.test/a.jpg")!),
          !DropArtworkPolicy.permitted(URL(string: "https://user:pass@i.ytimg.com/a.jpg")!),
          DropArtworkPolicy.permittedResponse(status: 200, mime: "image/jpeg", expectedBytes: 100),
          !DropArtworkPolicy.permittedResponse(status: 302, mime: "image/jpeg", expectedBytes: 100),
          !DropArtworkPolicy.permittedResponse(status: 200, mime: "text/html", expectedBytes: 100),
          !DropArtworkPolicy.permittedResponse(status: 200, mime: "image/png", expectedBytes: 2_100_000),
          DropArtworkPolicy.mayAppend(current: 2_097_000, incoming: 152),
          !DropArtworkPolicy.mayAppend(current: 2_097_000, incoming: 153) else {
      fatalError("DropArtworkPolicy tests failed")
    }
    print("DropArtworkPolicyTests: passed")
  }
}
