# Getting the app onto the App Store

What changed from the personal version, and what's left before a public release.
Build and TestFlight mechanics are in [ios-build-and-testflight.md](ios-build-and-testflight.md).

## What the app does now

- **Set up once:** home and work (address search or current location), the station you
  drive to and the one you travel to (National Rail, Elizabeth line, Overground, Tube,
  DLR), and per-day start times for each direction.
- **Starts by itself:** the server starts the Live Activity on schedule by push. No app
  launch and no Shortcuts automation are needed. Bank holidays and a "pause until" date
  are skipped.
- **Shows what matters:** trains you can still catch (after the drive and parking in the
  morning, after the walk in the evening) with platforms, line disruption, cancelled or
  late trains with the reason, and the drive against its no-traffic time.
- **Alerts:** a new problem during a commute arrives as a Live Activity alert, so the
  phone lights up.
- **Follows you:** geofences move the commute on (left home, at the station, on the
  train) and end it on arrival. There's no continuous GPS.
- **Privacy:** no accounts. Work location never leaves the phone. Home goes to the
  server only rounded to about 100 m. "Delete my data" erases everything on the server.

## Before submitting

### Must do

- [x] **Deploy the server** and set `BackendURL` in `ios/project.yml` (see `server/README.md`).
      Live at `https://commute-api.leatham.net` on the shared backend host.
- [ ] **Keys:** APNs key and Maps ID + key are done. Still to come: the Rail Data
      Marketplace LDBWS key (until then, TfL covers Elizabeth line and Overground stations).
      Read the RDM licence terms for public apps, and check their rate limits against
      the expected number of users.
- [ ] **Push capability:** tick Push Notifications on the `net.leatham.mycommute` App ID.
- [ ] **App name:** "My Commute" is probably taken on the store. Choose a name and set
      `CFBundleDisplayName` (both targets) and the App Store Connect record to match.
- [ ] **Privacy policy and support pages:** publish them and set `PrivacyPolicyURL`
      and `SupportURL` in `project.yml`. Both are required in App Store Connect.
- [ ] **App Privacy labels:** *Location (coarse)*, linked to the install's identifier,
      used for app functionality, not tracking. No contact info, no identifiers beyond
      the random install ID, no analytics.
- [ ] **Review notes:** say why "Always" location is needed (geofences start and stop
      the commute) and that there's no continuous tracking. Give a reviewer a station
      pair to try (e.g. Reading → London Paddington) and say that scheduled starts need
      a time a few minutes ahead.
- [ ] **First real-device test:** this code has not been compiled yet. CI builds it on
      the next push. Then check on a phone that push-to-start wakes the app and the
      update token reaches the server, that geofence events arrive with the app killed,
      and that a dismissed activity stops pushes.
- [ ] **Screenshots** (6.9" and 6.5") of setup, the home screen, the Lock Screen and the
      Dynamic Island.
- [ ] **Move private details out of this repo** before it goes public:
      `docs/ios-build-and-testflight.md` has the team and API key IDs.

### Should do

- [ ] **Abuse protection:** App Attest on `PUT /v1/me` so only the real app can register.
- [ ] **Monitoring:** the server only logs to stdout. Add uptime checks on `/healthz`
      and an alert when pushes start failing.
- [ ] **Accessibility:** check VoiceOver on the Lock Screen view; the emoji in problem
      text are read aloud.
- [ ] **Localisation** is English only; fine for a UK-only launch.
- [ ] **Pricing:** the server and Maps calls cost money as users grow. Consider a small
      one-off price or a subscription before launch rather than after.

## Known limits

- One train with no changes, both stations on the same network. Journeys that change
  trains (or switch between National Rail and the Tube) aren't supported yet.
- The first leg is assumed to be a drive. Walking or cycling to the station isn't
  modelled; the drive line just goes unused.
- Drive time is from home (morning) or from the station (evening). Once you've left
  home it isn't updated, because live position isn't sent to the server.
- iOS can delay or drop priority-5 Live Activity updates when the battery is low.
  Alerts go at priority 10.
