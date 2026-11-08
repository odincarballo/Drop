import AVFoundation
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
struct DropLocalMetadataExtractorTests {
  static func main() async throws {
    let cancellationChecks = DropThumbnailCancellationTests.run()
    for (name, passed) in cancellationChecks { print("\(passed ? "PASS" : "FAIL") \(name)") }
    if CommandLine.arguments[1] == "--cancellation-only" {
      exit(cancellationChecks.allSatisfy { $0.1 } ? 0 : 1)
    }
    let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let extractor = DropLocalMetadataExtractor(managedRoots: [root])
    let cover = try image(width: 40, height: 20)
    let mp3 = root.appendingPathComponent("tagged.mp3")
    try writeMP3(mp3, tags: ["TIT2": "Canción 東京", "TPE1": "Artista", "TALB": "Álbum", "TCON": "Jazz", "TYER": "2024"], artwork: cover)
    let bare = root.appendingPathComponent("bare.mp3")
    try writeMP3(bare, tags: [:])
    let bad = root.appendingPathComponent("corrupt-art.mp3")
    try writeMP3(bad, tags: ["TIT2": "Audio válido"], artwork: Data([1,2,3]))
    let m4a = root.appendingPathComponent("tagged.m4a")
    try await writeM4A(m4a, root: root)
    let video = root.appendingPathComponent("horizontal.mp4")
    let rotated = root.appendingPathComponent("rotated.mp4")
    try await writeVideo(video, rotated: false)
    try await writeVideo(rotated, rotated: true)
    let inputs = [mp3, bare, bad, m4a, video, rotated]
    let hashes = try inputs.map { SHA256.hash(data: try Data(contentsOf: $0)).description }
    var failures = cancellationChecks.filter { !$0.1 }.count; var passed = cancellationChecks.filter { $0.1 }.count
    func check(_ ok: Bool, _ label: String) {
      print("\(ok ? "PASS" : "FAIL") \(label)")
      fflush(stdout)
      if ok { passed += 1 } else { failures += 1 }
    }
    let audio = try await extractor.extract(mp3, validatedDuration: 0.8)
    check(audio.title == "Canción 東京" && audio.artist == "Artista" && audio.album == "Álbum" && audio.genre == "Jazz" && audio.year == 2024, "MP3 complete ID3 + Unicode")
    check(audio.jpeg != nil, "MP3 embedded cover")
    let aac = try await extractor.extract(m4a, validatedDuration: 0.5)
    check(aac.title == "M4A Title" && aac.artist == "AAC Artist" && aac.album == "Album" && aac.genre == "Jazz" && aac.year == 2023, "real M4A metadata")
    let empty = try await extractor.extract(bare, validatedDuration: 0.8)
    check(empty.title == nil && empty.artist == nil && empty.album == nil && empty.genre == nil && empty.year == nil && empty.jpeg == nil, "absent fields and cover explicit")
    check(DropLocalMetadataExtractor.text(" \n\u{0} ") == nil && DropLocalMetadataExtractor.text("  Música\n東京  ") == "Música 東京", "invalid title and Unicode normalization")
    check(DropLocalMetadataExtractor.text(String(repeating: "a", count: 300))?.count == 240, "bounded text")
    check(DropLocalMetadataExtractor.year("2020/2021") == nil && DropLocalMetadataExtractor.year("2020-99-01") == nil && DropLocalMetadataExtractor.year("0000") == nil && DropLocalMetadataExtractor.year("2024-02-29") == 2024, "invalid ambiguous and calendar years")
    let corrupt = try await extractor.extract(bad, validatedDuration: 0.8)
    check(corrupt.title == "Audio válido" && corrupt.jpeg == nil, "valid audio survives corrupt artwork")
    check(DropLocalMetadataExtractor.normalizedJPEG(Data([1,2,3])) == nil, "corrupt image rejected")
    check(DropLocalMetadataExtractor.normalizedJPEG(Data(count: 2 * 1_048_576 + 1)) == nil, "compressed size bound")
    check(DropLocalMetadataExtractor.normalizedJPEG(try image(width: 4097, height: 1)) == nil, "excessive dimensions rejected")
    let scaled = DropLocalMetadataExtractor.normalizedJPEG(try image(width: 1000, height: 500))
    check(dimensions(scaled).map { $0.0 == 512 && $0.1 == 256 } == true, "embedded cover downsampling preserves ratio")
    check(DropLocalMetadataExtractor.normalizedJPEG(cover.prefix(cover.count / 2)) == nil, "truncated image rejected")
    let link = root.appendingPathComponent("link.mp3")
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: mp3)
    check(try await extractor.extract(link, validatedDuration: 1).issues.contains(.invalidSource), "symlink rejected")
    let failingVideo = root.appendingPathComponent("broken.mp4")
    try Data([1, 2, 3]).write(to: failingVideo)
    check(try await extractor.extract(failingVideo, validatedDuration: 1).issues.contains(.thumbnailUnavailable), "thumbnail failure is optional")
    let wide = try await extractor.extract(video, validatedDuration: 0.1)
    let tall = try await extractor.extract(rotated, validatedDuration: 0.1)
    check(dimensions(wide.jpeg).map { $0.0 > $0.1 && $0.0 <= 512 } == true, "short horizontal MP4")
    check(dimensions(tall.jpeg).map { $0.1 > $0.0 && $0.1 <= 512 } == true, "rotated vertical MP4")
    let fake = root.appendingPathComponent("broken.mp3");try Data([1,2,3]).write(to: fake)
    let partial = try await extractor.extract(fake, validatedDuration: 1)
    check(partial.title == nil && partial.jpeg == nil, "corrupt metadata returns optional result")
    let cancelled = Task { try await extractor.extract(mp3, validatedDuration: 0.8) };cancelled.cancel()
    do { _ = try await cancelled.value;check(false,"cancellation") } catch is CancellationError { check(true,"cancellation") }
    let inFlight = Task { try await extractor.extract(video, validatedDuration: 0.1) }
    await Task.yield()
    inFlight.cancel()
    do { let completed = try await inFlight.value; check(completed.jpeg != nil, "in-flight cancellation lost race to valid completed extraction") }
    catch is CancellationError { check(true, "in-flight cancellation propagated") }
    check(try await extractor.extract(mp3, validatedDuration: 0.8).title == "Canción 東京", "extractor usable after cancellation")
    let outside = try await extractor.extract(root.deletingLastPathComponent().appendingPathComponent("external.mp3"), validatedDuration: 1)
    check(outside.issues.contains(.invalidSource), "outside managed roots rejected")
    let remote = try await extractor.extract(URL(string:"https://example.com/a.mp3")!, validatedDuration: 1)
    check(remote.issues.contains(.invalidSource), "network URL rejected before AVFoundation")
    check(try inputs.enumerated().allSatisfy { SHA256.hash(data: try Data(contentsOf: $0.element)).description == hashes[$0.offset] }, "all source media unchanged")
    print("TOTAL \(passed) PASS, \(failures) FAIL")
    if failures > 0 { exit(1) }
  }

  static func dimensions(_ data: Data?) -> (Int,Int)? {
    guard let data, let src = CGImageSourceCreateWithData(data as CFData,nil), let p = CGImageSourceCopyPropertiesAtIndex(src,0,nil) as? [CFString:Any], let w = p[kCGImagePropertyPixelWidth] as? Int, let h = p[kCGImagePropertyPixelHeight] as? Int else { return nil };return (w,h)
  }
  static func image(width: Int, height: Int) throws -> Data {
    let ctx = CGContext(data:nil,width:width,height:height,bitsPerComponent:8,bytesPerRow:width*4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(CGColor(red:0.2,green:0.6,blue:0.8,alpha:1));ctx.fill(CGRect(x:0,y:0,width:width,height:height))
    let data=NSMutableData();let out=CGImageDestinationCreateWithData(data,UTType.png.identifier as CFString,1,nil)!;CGImageDestinationAddImage(out,ctx.makeImage()!,nil);guard CGImageDestinationFinalize(out) else { throw Failure.fixture };return data as Data
  }
  enum Failure: Error { case fixture }
  static func writeMP3(_ url: URL, tags: [String:String], artwork: Data? = nil) throws {
    func be(_ n: Int) -> Data { Data([UInt8((n>>24)&255),UInt8((n>>16)&255),UInt8((n>>8)&255),UInt8(n&255)]) }
    func frame(_ key: String,_ value: Data) -> Data { Data(key.utf8)+be(value.count)+Data([0,0])+value }
    var payload=Data()
    for (key,value) in tags.sorted(by: { $0.key < $1.key }) { payload += frame(key,Data([1,0xff,0xfe])+value.data(using:.utf16LittleEndian)!) }
    if let artwork { payload += frame("APIC",Data([0])+Data("image/png".utf8)+Data([0,3,0])+artwork) }
    let n=payload.count;let sync=Data([UInt8((n>>21)&127),UInt8((n>>14)&127),UInt8((n>>7)&127),UInt8(n&127)])
    var data=Data("ID3".utf8)+Data([3,0,0])+sync+payload
    let audio=Data([0xff,0xfb,0x90,0xc4])+Data(count:413)
    for _ in 0..<40 { data += audio };try data.write(to:url)
  }
  static func writeM4A(_ url: URL, root: URL) async throws {
    let raw=root.appendingPathComponent("raw.m4a")
    let format=AVAudioFormat(standardFormatWithSampleRate:44100,channels:1)!;let buffer=AVAudioPCMBuffer(pcmFormat:format,frameCapacity:22050)!;buffer.frameLength=22050
    for i in 0..<22050 { buffer.floatChannelData![0][i]=0 }
    do { let f=try AVAudioFile(forWriting:raw,settings:[AVFormatIDKey:kAudioFormatMPEG4AAC,AVSampleRateKey:44100,AVNumberOfChannelsKey:1]);try f.write(from:buffer) }
    let export=AVAssetExportSession(asset:AVURLAsset(url:raw),presetName:AVAssetExportPresetAppleM4A)!
    export.outputURL=url;export.outputFileType = .m4a
    export.metadata = [(.iTunesMetadataSongName,"M4A Title"),(.iTunesMetadataArtist,"AAC Artist"),(.iTunesMetadataAlbum,"Album"),(.iTunesMetadataUserGenre,"Jazz"),(.iTunesMetadataReleaseDate,"2023")].map { (id: AVMetadataIdentifier,value: String) in let m=AVMutableMetadataItem();m.identifier=id;m.value=value as NSString;return m }
    await export.export();guard export.status == .completed else { throw export.error ?? Failure.fixture }
  }
  static func writeVideo(_ url: URL, rotated: Bool) async throws {
    let writer=try AVAssetWriter(outputURL:url,fileType:.mp4);let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:64,AVVideoHeightKey:32]);input.expectsMediaDataInRealTime=false
    if rotated { input.transform=CGAffineTransform(rotationAngle:.pi/2) }
    let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:64,kCVPixelBufferHeightKey as String:32]);writer.add(input);guard writer.startWriting() else { throw Failure.fixture };writer.startSession(atSourceTime:.zero)
    var p:CVPixelBuffer?;CVPixelBufferCreate(kCFAllocatorDefault,64,32,kCVPixelFormatType_32ARGB,nil,&p);let pixel=p!;CVPixelBufferLockBaseAddress(pixel,[]);memset(CVPixelBufferGetBaseAddress(pixel),128,CVPixelBufferGetDataSize(pixel));CVPixelBufferUnlockBaseAddress(pixel,[])
    for t in [0.0,0.1] { while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds:1_000_000) };guard adaptor.append(pixel,withPresentationTime:CMTime(seconds:t,preferredTimescale:600)) else { throw Failure.fixture } }
    input.markAsFinished();await withCheckedContinuation { c in writer.finishWriting { c.resume() } };guard writer.status == .completed else { throw writer.error ?? Failure.fixture }
  }
}
