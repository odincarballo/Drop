#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

for path in ios node_modules modules/on-device-youtube/vendor; do
  if [[ -e "$path" ]]; then
    echo "Clean checkout required; already exists: $path" >&2
    exit 1
  fi
done
for path in .env .env.production; do
  if [[ -e "$path" ]]; then
    echo "Clean checkout required; untracked environment exists: $path" >&2
    exit 1
  fi
done

# These are public build settings. The access token stays in iOS SecureStore.
set -a
source ./.env.production.example
set +a

npm ci --no-audit --no-fund
node scripts/prepare_on_device_youtube.mjs

if ! gem list --local --installed bundler --version 2.4.22 >/dev/null; then
  gem install --user-install bundler --version 2.4.22 --no-document
fi
bundle _2.4.22_ config set --local path vendor/bundle
bundle _2.4.22_ install --frozen

EXPO_USE_PRECOMPILED_MODULES=0 npx expo prebuild --platform ios --no-install
bundle _2.4.22_ exec ruby scripts/configure_on_device_youtube.rb

RUBYOPT="-rbundler/setup -r$PWD/scripts/cocoapods_compat.rb" \
  CP_HOME_DIR="$PWD/.cocoapods" RCT_SKIP_CACHES=1 \
  EXPO_USE_PRECOMPILED_MODULES=0 \
  bundle _2.4.22_ exec pod install --project-directory=ios

workspace="$(bundle _2.4.22_ exec ruby scripts/ios_application_project.rb --workspace)"
scheme="$(bundle _2.4.22_ exec ruby scripts/ios_application_project.rb --scheme)"
destination="${DROP_IOS_DESTINATION:-generic/platform=iOS}"
team="${DROP_DEVELOPMENT_TEAM:-HK927RUDLZ}"

EXPO_USE_PRECOMPILED_MODULES=0 NODE_ENV=production \
  xcodebuild -workspace "$workspace" -scheme "$scheme" \
  -configuration Release -sdk iphoneos -destination "$destination" \
  -derivedDataPath ios/build/clean-release -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$team" build
