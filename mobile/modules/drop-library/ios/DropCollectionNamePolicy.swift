import Foundation

enum DropCollectionNameError: String, Error {
  case empty
  case tooLong
  case controlCharacter
  case reserved
}

struct DropCollectionName {
  let name: String
  let normalizedName: String
}

enum DropCollectionNamePolicy {
  private static let spanish = Locale(identifier: "es")
  private static let reservedName = normalizedKey("Sin colección")

  static func newID() -> String { UUID().uuidString.lowercased() }

  static func normalize(_ raw: String) throws -> DropCollectionName {
    if raw.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains) {
      throw DropCollectionNameError.controlCharacter
    }
    var collapsed = String.UnicodeScalarView()
    var pendingSpace = false
    for scalar in raw.unicodeScalars {
      if CharacterSet.whitespaces.contains(scalar) {
        if !collapsed.isEmpty { pendingSpace = true }
      } else {
        if pendingSpace { collapsed.append(" ") }
        collapsed.append(scalar)
        pendingSpace = false
      }
    }
    let name = String(collapsed).precomposedStringWithCanonicalMapping
    guard !name.isEmpty else { throw DropCollectionNameError.empty }
    guard name.count <= 80 else { throw DropCollectionNameError.tooLong }
    let normalizedName = normalizedKey(name)
    guard normalizedName != reservedName else { throw DropCollectionNameError.reserved }
    return DropCollectionName(name: name, normalizedName: normalizedName)
  }

  private static func normalizedKey(_ name: String) -> String {
    name.folding(options: [.caseInsensitive], locale: spanish)
      .precomposedStringWithCanonicalMapping
  }
}
