# frozen_string_literal: true

# CocoaPods runs with the Ruby 2.6 bundled with macOS on this development Mac.
# Expo's pod helpers use Array#filter_map (Ruby 2.7+) and CocoaPods otherwise
# treats subprocess output containing the repository's `Ø` path as binary.
# Keep these build-tool compatibility fixes isolated from application code.

require "logger"
require "open3"

unless [].respond_to?(:filter_map)
  class Array
    def filter_map
      return enum_for(__method__) unless block_given?

      each_with_object([]) do |item, result|
        value = yield item
        result << value if value
      end
    end
  end
end

module MediaDropUTF8Open3
  def popen3(*command, &block)
    unless block
      streams = super(*command)
      streams[1].set_encoding(Encoding::UTF_8)
      streams[2].set_encoding(Encoding::UTF_8)
      return streams
    end

    super(*command) do |stdin, stdout, stderr, wait_thread|
      stdout.set_encoding(Encoding::UTF_8)
      stderr.set_encoding(Encoding::UTF_8)
      block.call(stdin, stdout, stderr, wait_thread)
    end
  end
end

Open3.singleton_class.prepend(MediaDropUTF8Open3)

require "cocoapods"

module MediaDropUTF8PodExecutable
  def execute_command(executable, command, raise_on_failure = true)
    super(executable, command, raise_on_failure).force_encoding(Encoding::UTF_8)
  end
end

Pod::Executable.singleton_class.prepend(MediaDropUTF8PodExecutable)
