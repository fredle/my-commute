# Building the iOS app and shipping it to TestFlight

Copied from the portmon project on 2026-11-12, where this setup was worked out
and is running. Everything here is what actually worked there; anything not yet
done for this app is marked **To do**.

## How it works

A GitHub Actions workflow (`.github/workflows/ios.yml`) does the whole release
on a GitHub-hosted macOS runner. No Mac of ours is involved.

1. The runner compiles an **unsigned** release archive.
2. `xcodebuild -exportArchive` signs it with Apple's **cloud-managed signing**
   and uploads it to App Store Connect, authenticated by an App Store Connect
   API key.
3. Apple processes the build and TestFlight offers it to internal testers.

No certificates, provisioning profiles or keychains are set up anywhere. Apple
picks the next build number itself (`manageAppVersionAndBuildNumber`).

In portmon the first run took about two minutes on the `macos-26` runner, which
carried Xcode 26.6 (build 17F113).

## Account facts (shared with portmon)

| Thing | Value |
|---|---|
| Apple Developer team ID | `R53MF3F498` (paid individual membership) |
| App Store Connect API Key ID | `LCXQJ6V63G` (Admin role) |
| API Issuer ID | `7bddb3e6-397f-4963-8915-e0b76c937bcc` |
| Key file | on the Mac `freddie-macbook-air` at `~/.appstoreconnect/private_keys/AuthKey_LCXQJ6V63G.p8` |

The key file itself is deliberately **not** in this folder. Apple only lets a
key be downloaded once, so the Mac copy is the only file copy; the same key is
also stored as a GitHub secret in the portmon repo (secrets cannot be read back
out).

Already done once for the account, nothing to repeat: Developer Program
enrolment, the Free Apps Agreement, and creating the Admin API key.

## To do for this app

> **Status:** step 1 and 2 are done. The app source is in `ios/`, and the Xcode
> project is generated in CI from `ios/project.yml` (XcodeGen). It has two
> targets: `net.leatham.mycommute` and the Live Activity extension
> `net.leatham.mycommute.widgets`. Register **both** bundle IDs in step 3
> (automatic signing may also create the second one itself). Nothing has been
> compiled yet; the first CI run is the first build.

1. **Create the Xcode project** under `ios/`, with:
   - Team `R53MF3F498`, automatic signing.
   - A bundle ID, e.g. `net.leatham.mycommute`.
   - A 1024×1024 app icon in the asset catalog (the upload is rejected without one).
   - Build setting `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO` if the app
     only uses standard HTTPS. This removes the "Missing Compliance" question
     that otherwise has to be answered by hand for every build.
2. **Set the three names at the top of `.github/workflows/ios.yml`**
   (`XCODE_PROJECT`, `SCHEME`) to match the project.
3. **Register the bundle ID**: developer.apple.com/account → Certificates,
   Identifiers & Profiles → Identifiers → **+** → App IDs → App, Explicit.
4. **Create the app record**: appstoreconnect.apple.com → Apps → **+** → New
   App. Platform iOS, pick the bundle ID, any SKU. The name must be unique
   across the App Store. Apple does not allow this step through the API.
5. **Set the GitHub secrets** on this project's repo (PowerShell). The key file
   has to be fetched from the Mac first:

   ```powershell
   scp freddie-macbook-air:.appstoreconnect/private_keys/AuthKey_LCXQJ6V63G.p8 $env:TEMP\
   gh secret set ASC_KEY_ID --body "LCXQJ6V63G"
   gh secret set ASC_ISSUER_ID --body "7bddb3e6-397f-4963-8915-e0b76c937bcc"
   Get-Content -Raw $env:TEMP\AuthKey_LCXQJ6V63G.p8 | gh secret set ASC_PRIVATE_KEY
   Remove-Item $env:TEMP\AuthKey_LCXQJ6V63G.p8
   ```

6. **Testers**: in App Store Connect → the app → TestFlight → Internal Testing,
   create a group and add testers. Each tester installs the TestFlight app and
   signs in with their Apple ID. Internal testers must be users on the App
   Store Connect team (role Developer, restricted to this app, is enough) and
   need no Apple review. External testers need a Beta App Review of the first
   build of each version.

After that, every push to `main` touching `ios/**` uploads a new build. To run
it by hand:

```powershell
gh workflow run ios.yml
```

## Gotchas found the hard way

- **The API key must be Admin.** An App Manager key fails at export with
  "Cloud signing permission error".
- **`FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`** means an agreement is
  pending in App Store Connect → Business.
- **"Error Downloading App Information"** means the app record (step 4) does
  not exist yet for that bundle ID.
- **Private repos pay 10× for macOS minutes**, so 2,000 free minutes are about
  200 macOS minutes a month.
- **TestFlight builds expire after 90 days.** Re-run the workflow to refresh.
- **PowerShell has no `<` redirect**; pipe with `Get-Content -Raw … |` instead.
- **Keep `*.p8` out of git** (already in this folder's `.gitignore`).

## Fallback: building on the Mac over SSH

The same recipe works from `freddie-macbook-air` if the runner is unavailable.
Local code signing does **not** work over SSH (the login keychain is locked to
SSH sessions: `errSecInternalComponent`, "No Accounts"), which is why the
archive is unsigned and Apple signs it at export.

```bash
cd ~/devel/<repo>/ios

xcodebuild archive -project <App>.xcodeproj -scheme <App> -configuration Release \
  -destination "generic/platform=iOS" -derivedDataPath build \
  -archivePath build/<App>.xcarchive CODE_SIGNING_ALLOWED=NO

xcodebuild -exportArchive -archivePath build/<App>.xcarchive \
  -exportOptionsPlist build/ExportOptions.plist -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_LCXQJ6V63G.p8 \
  -authenticationKeyID LCXQJ6V63G \
  -authenticationKeyIssuerID 7bddb3e6-397f-4963-8915-e0b76c937bcc
```

`ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>R53MF3F498</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><true/>
</dict></plist>
```

Installing straight onto an iPhone from the Mac (instead of TestFlight) needs
the phone on USB or the same Wi-Fi as the Mac; it does not work over Tailscale,
and it needs the keychain unlocked at the Mac.
