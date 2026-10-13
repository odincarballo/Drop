import Foundation

@main
enum DropCollectionNamePolicyTests {
  static func expect(_ raw: String, name: String, key: String) throws {
    let result = try DropCollectionNamePolicy.normalize(raw)
    precondition(result.name == name, "Unexpected display name for \(raw)")
    precondition(result.normalizedName == key, "Unexpected normalized name for \(raw)")
  }

  static func rejects(_ raw: String, _ expected: DropCollectionNameError) {
    do {
      _ = try DropCollectionNamePolicy.normalize(raw)
      fatalError("Expected \(expected) for \(raw)")
    } catch let error as DropCollectionNameError {
      precondition(error == expected)
    } catch {
      fatalError("Unexpected error: \(error)")
    }
  }

  static func main() throws {
    rejects("", .empty)
    rejects("  \u{00A0}  ", .empty)
    try expect("  Cursos   Python  ", name: "Cursos Python", key: "cursos python")
    try expect("\u{00A0}Cursos\u{2003}\u{2003}Python\u{00A0}",
               name: "Cursos Python", key: "cursos python")
    try expect("Música", name: "Música", key: "música")
    try expect("música", name: "música", key: "música")
    try expect("Musica", name: "Musica", key: "musica")
    try expect("Mu\u{0301}sica", name: "Música", key: "música")
    try expect("🎧", name: "🎧", key: "🎧")
    rejects("👩🏽‍💻", .controlCharacter) // U+200D belongs to Foundation's controlCharacters.
    try expect("A", name: "A", key: "a")
    try expect(String(repeating: "x", count: 80),
               name: String(repeating: "x", count: 80),
               key: String(repeating: "x", count: 80))
    rejects(String(repeating: "x", count: 81), .tooLong)
    rejects("a\nB", .controlCharacter)
    rejects("a\u{0000}b", .controlCharacter)
    rejects("Sin colección", .reserved)
    rejects("  SIN  COLECCIÓN  ", .reserved)
    let id = DropCollectionNamePolicy.newID()
    precondition(UUID(uuidString: id) != nil)
    precondition(DropCollectionNamePolicy.newID() != id)
    print("DropCollectionNamePolicyTests: passed")
  }
}
