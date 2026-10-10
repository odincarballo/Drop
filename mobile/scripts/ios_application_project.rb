# frozen_string_literal: true

require 'xcodeproj'

module IOSApplicationProject
  ROOT = File.expand_path('..', __dir__)

  def self.open
    # Expo resolves DROP_BUNDLE_IDENTIFIER in app.config.js before prebuild.
    bundle_id = ENV.fetch('DROP_BUNDLE_IDENTIFIER')
    raise 'DROP_BUNDLE_IDENTIFIER is required for the generated iOS project' if bundle_id.empty?
    projects = Dir.glob(File.join(ROOT, 'ios', '*.xcodeproj')).select { |path| File.directory?(path) }
    raise "Expected one generated iOS project, found #{projects.length}" unless projects.length == 1

    project = Xcodeproj::Project.open(projects.first)
    targets = project.targets.select do |target|
      target.respond_to?(:product_type) &&
        target.product_type == 'com.apple.product-type.application' &&
        target.build_configurations.all? do |build_configuration|
          build_configuration.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] == bundle_id
        end
    end
    raise "Expected one app target for #{bundle_id}, found #{targets.length}" unless targets.length == 1

    [project, targets.first]
  end

  def self.embed_phase(target)
    target.shell_script_build_phases.find do |phase|
      phase.shell_script.to_s.include?('scripts/embed_on_device_python.sh')
    end
  end
end

if $PROGRAM_NAME == __FILE__
  project, target = IOSApplicationProject.open
  case ARGV.fetch(0)
  when '--workspace'
    puts project.path.to_s.sub(/\.xcodeproj\z/, '.xcworkspace')
  when '--scheme'
    puts target.name
  else
    abort 'Expected --workspace or --scheme'
  end
end
