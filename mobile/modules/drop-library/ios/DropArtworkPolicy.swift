import Foundation

enum DropArtworkPolicy {
  static let maximumBytes = 2 * 1_048_576

  static func permitted(_ url: URL) -> Bool {
    guard url.scheme?.lowercased() == "https", url.user == nil, url.password == nil,
          url.port == nil, url.query == nil, url.fragment == nil,
          let host = url.host?.lowercased() else { return false }
    return host == "ytimg.com" || host.hasSuffix(".ytimg.com")
  }

  static func permittedResponse(status: Int, mime: String?, expectedBytes: Int64) -> Bool {
    status == 200
      && ["image/jpeg", "image/png", "image/webp"].contains(mime?.lowercased() ?? "")
      && expectedBytes <= Int64(maximumBytes)
  }

  static func mayAppend(current: Int, incoming: Int) -> Bool {
    current >= 0 && incoming >= 0 && current <= maximumBytes - incoming
  }
}
