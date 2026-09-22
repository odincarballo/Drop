import Darwin
import Foundation

enum MDAudioDownloadFailure: Error {
  case code(String)

  var code: String {
    switch self {
    case .code(let value): return value
    }
  }
}

enum MDLocalDownloadKind: String {
  case audio
  case video

  var container: String { self == .audio ? "m4a" : "mp4" }
  var maximumBytes: Int64 {
    self == .audio ? 25 * 1024 * 1024 : 50 * 1024 * 1024
  }
}

struct MDVideoContentRange: Equatable {
  let start: Int64
  let end: Int64
  let total: Int64
}

enum MDAudioDownloadPolicy {
  static let maximumBytes: Int64 = 25 * 1024 * 1024
  static let maximumVideoBytes: Int64 = 50 * 1024 * 1024
  static let maximumRedirects = 3
  // URLSession applies this as an inactivity timeout, not only to connection setup.
  static let requestTimeoutSeconds: TimeInterval = 60
  static let resourceTimeoutSeconds: TimeInterval = 5 * 60
  static let allowedHeaders = Set([
    "accept", "accept-language", "origin", "referer", "user-agent",
  ])
  static let forbiddenHeaders = Set([
    "authorization", "cookie", "proxy-authorization",
  ])
  static let allowedAudioMIMETypes = Set([
    "application/mp4", "application/octet-stream", "audio/mp4", "audio/x-m4a",
  ])
  static let allowedVideoMIMETypes = Set([
    "application/mp4", "application/octet-stream", "video/mp4",
  ])

  static func validateURL(
    _ url: URL,
    kind: MDLocalDownloadKind = .audio,
    resolveDNS: Bool = true
  ) throws {
    guard
      url.scheme?.lowercased() == "https",
      url.user == nil,
      url.password == nil,
      url.port == nil || url.port == 443,
      let host = url.host?.lowercased(),
      host == "googlevideo.com" || host.hasSuffix(".googlevideo.com")
    else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_URL_INVALID" : "VIDEO_URL_INVALID"
      )
    }
    if resolveDNS, !hostResolvesOnlyToPublicAddresses(host) {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_DNS_INVALID" : "VIDEO_DNS_INVALID"
      )
    }
  }

  static func validateHeaders(
    _ headers: [String: String],
    kind: MDLocalDownloadKind = .audio
  ) throws -> [String: String] {
    var validated: [String: String] = [:]
    for (rawName, value) in headers {
      let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
      if forbiddenHeaders.contains(name) {
        throw MDAudioDownloadFailure.code(
          kind == .audio ? "AUDIO_HEADERS_FORBIDDEN" : "VIDEO_HEADERS_FORBIDDEN"
        )
      }
      guard
        allowedHeaders.contains(name),
        value.utf8.count <= 1024,
        !value.contains("\r"),
        !value.contains("\n")
      else {
        throw MDAudioDownloadFailure.code(
          kind == .audio ? "AUDIO_HEADERS_INVALID" : "VIDEO_HEADERS_INVALID"
        )
      }
      validated[rawName] = value
    }
    return validated
  }

  static func validateResponse(
    _ response: HTTPURLResponse,
    kind: MDLocalDownloadKind = .audio
  ) throws {
    guard response.statusCode == 200 || response.statusCode == 206 else {
      throw MDAudioDownloadFailure.code(
        kind == .audio
          ? (response.statusCode == 404 || response.statusCode == 410
            ? "AUDIO_URL_EXPIRED" : "AUDIO_HTTP_ERROR")
          : (response.statusCode == 404 || response.statusCode == 410
            ? "VIDEO_URL_EXPIRED" : "VIDEO_HTTP_ERROR")
      )
    }
    let allowedMIMETypes =
      kind == .audio ? allowedAudioMIMETypes : allowedVideoMIMETypes
    if let mime = response.mimeType?.lowercased(), !allowedMIMETypes.contains(mime) {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_MIME_NOT_ALLOWED" : "VIDEO_MIME_NOT_ALLOWED"
      )
    }
    try validateExpectedLength(response.expectedContentLength, maximumBytes: kind.maximumBytes)
  }

  static func validateRangeResponse(
    _ response: HTTPURLResponse,
    requestedStart: Int64,
    requestedEnd: Int64,
    kind: MDLocalDownloadKind
  ) throws -> MDVideoContentRange {
    guard response.statusCode == 206 else {
      throw MDAudioDownloadFailure.code(
        response.statusCode == 404 || response.statusCode == 410
          ? (kind == .audio ? "AUDIO_URL_EXPIRED" : "VIDEO_URL_EXPIRED")
          : (kind == .audio ? "AUDIO_RANGE_NOT_SUPPORTED" : "VIDEO_RANGE_NOT_SUPPORTED")
      )
    }
    let allowedMIMETypes =
      kind == .audio ? allowedAudioMIMETypes : allowedVideoMIMETypes
    if let mime = response.mimeType?.lowercased(), !allowedMIMETypes.contains(mime) {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_MIME_NOT_ALLOWED" : "VIDEO_MIME_NOT_ALLOWED"
      )
    }
    guard
      let raw = response.value(forHTTPHeaderField: "Content-Range"),
      let range = parseVideoContentRange(raw),
      range.start == requestedStart,
      range.end <= requestedEnd,
      range.end >= range.start
    else {
      throw MDAudioDownloadFailure.code(
        kind == .audio ? "AUDIO_RANGE_INVALID" : "VIDEO_RANGE_INVALID"
      )
    }
    try validateExpectedLength(range.total, maximumBytes: kind.maximumBytes)
    return range
  }

  static func validateVideoRangeResponse(
    _ response: HTTPURLResponse,
    requestedStart: Int64,
    requestedEnd: Int64
  ) throws -> MDVideoContentRange {
    try validateRangeResponse(
      response,
      requestedStart: requestedStart,
      requestedEnd: requestedEnd,
      kind: .video
    )
  }

  static func parseVideoContentRange(_ raw: String) -> MDVideoContentRange? {
    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.lowercased().hasPrefix("bytes ") else { return nil }
    let pieces = value.dropFirst(6).split(separator: "/", omittingEmptySubsequences: false)
    guard pieces.count == 2, let total = Int64(pieces[1]), total > 0 else { return nil }
    let bounds = pieces[0].split(separator: "-", omittingEmptySubsequences: false)
    guard
      bounds.count == 2,
      let start = Int64(bounds[0]),
      let end = Int64(bounds[1]),
      start >= 0,
      end >= start,
      end < total
    else { return nil }
    return MDVideoContentRange(start: start, end: end, total: total)
  }

  static func validateExpectedLength(
    _ length: Int64,
    maximumBytes: Int64 = maximumBytes
  ) throws {
    if length > maximumBytes {
      throw MDAudioDownloadFailure.code(
        maximumBytes == maximumVideoBytes ? "VIDEO_FILE_TOO_LARGE" : "AUDIO_FILE_TOO_LARGE"
      )
    }
  }

  static func validateTransferredBytes(
    _ bytes: Int64,
    maximumBytes: Int64 = maximumBytes
  ) throws {
    if bytes > maximumBytes {
      throw MDAudioDownloadFailure.code(
        maximumBytes == maximumVideoBytes ? "VIDEO_FILE_TOO_LARGE" : "AUDIO_FILE_TOO_LARGE"
      )
    }
  }

  static func safeFileName(_ candidate: String, extension fileExtension: String = "m4a") -> String {
    let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|%\u{0000}")
      .union(.newlines)
      .union(.controlCharacters)
    let pieces = candidate.components(separatedBy: invalid)
    var value = pieces.joined(separator: "_").trimmingCharacters(in: CharacterSet(charactersIn: " ."))
    let suffix = ".\(fileExtension.lowercased())"
    if value.lowercased().hasSuffix(suffix) {
      value.removeLast(suffix.count)
    }
    let stem = String(value.prefix(100)).trimmingCharacters(in: CharacterSet(charactersIn: " ."))
    let fallback = fileExtension == "m4a" ? "YouTube audio" : "YouTube video"
    return "\(stem.isEmpty ? fallback : stem).\(fileExtension)"
  }

  static func workspace(for jobID: String, fileManager: FileManager = .default) throws -> URL {
    guard UUID(uuidString: jobID) != nil else {
      throw MDAudioDownloadFailure.code("AUDIO_JOB_INVALID")
    }
    guard let caches = fileManager.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      throw MDAudioDownloadFailure.code("AUDIO_STORAGE_UNAVAILABLE")
    }
    let root = caches.appendingPathComponent("MediaDrop", isDirectory: true)
    let directory = root.appendingPathComponent(jobID, isDirectory: true)
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  static func removeWorkspace(_ directory: URL?, fileManager: FileManager = .default) {
    guard let directory else { return }
    try? fileManager.removeItem(at: directory)
  }

  private static func hostResolvesOnlyToPublicAddresses(_ host: String) -> Bool {
    var hints = addrinfo(
      ai_flags: AI_ADDRCONFIG,
      ai_family: AF_UNSPEC,
      ai_socktype: SOCK_STREAM,
      ai_protocol: IPPROTO_TCP,
      ai_addrlen: 0,
      ai_canonname: nil,
      ai_addr: nil,
      ai_next: nil
    )
    var result: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, "443", &hints, &result) == 0, let first = result else {
      return false
    }
    defer { freeaddrinfo(result) }
    var found = false
    var cursor: UnsafeMutablePointer<addrinfo>? = first
    while let entry = cursor?.pointee {
      guard let address = entry.ai_addr else { return false }
      var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      guard
        getnameinfo(
          address,
          entry.ai_addrlen,
          &buffer,
          socklen_t(buffer.count),
          nil,
          0,
          NI_NUMERICHOST
        ) == 0,
        isPublicIPAddress(String(cString: buffer))
      else {
        return false
      }
      found = true
      cursor = entry.ai_next
    }
    return found
  }

  private static func isPublicIPAddress(_ address: String) -> Bool {
    var ipv4 = in_addr()
    if inet_pton(AF_INET, address, &ipv4) == 1 {
      return isPublicIPv4(UInt32(bigEndian: ipv4.s_addr))
    }
    var ipv6 = in6_addr()
    guard inet_pton(AF_INET6, address, &ipv6) == 1 else { return false }
    let bytes = withUnsafeBytes(of: &ipv6) { Array($0) }
    if bytes[0..<10].allSatisfy({ $0 == 0 }), bytes[10] == 0xff, bytes[11] == 0xff {
      let value = bytes[12...15].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
      return isPublicIPv4(value)
    }
    let nat64Prefix: [UInt8] = [0x00, 0x64, 0xff, 0x9b] + Array(repeating: 0, count: 8)
    if Array(bytes[0..<12]) == nat64Prefix {
      let value = bytes[12...15].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
      return isPublicIPv4(value)
    }
    guard (bytes[0] & 0xe0) == 0x20 else { return false }
    return !(bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0x0d && bytes[3] == 0xb8)
  }

  private static func isPublicIPv4(_ value: UInt32) -> Bool {
    let first = UInt8((value >> 24) & 0xff)
    let second = UInt8((value >> 16) & 0xff)
    if first == 0 || first == 10 || first == 127 || first >= 224 { return false }
    if first == 100 && (64...127).contains(second) { return false }
    if first == 169 && second == 254 { return false }
    if first == 172 && (16...31).contains(second) { return false }
    if first == 192 && second == 168 { return false }
    if first == 192 && second == 0 { return false }
    if first == 198 && (second == 18 || second == 19 || second == 51) { return false }
    if first == 203 && second == 0 { return false }
    return true
  }
}
