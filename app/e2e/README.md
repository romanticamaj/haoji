# Cross-platform UI e2e

Two layers. Each catches what the other can't.

| Layer | Runs on | What it proves |
|---|---|---|
| `npm run e2e:recording` (XCUITest + ffprobe) | iOS simulator | Recording and call interruption write real audio to disk |
| Maestro flows here, against `stub-server.mjs` | iOS simulator **and** Android emulator | Pairing deep link → record → transcript → search, through the real UI |

```bash
node e2e/stub-server.mjs                       # :7799, serves backend/tests/fixtures/contracts
maestro test e2e/maestro/pair.yaml             # iOS simulator (STUB_HOST defaults to 127.0.0.1)
maestro test -e STUB_HOST=10.0.2.2 e2e/maestro/pair.yaml   # Android emulator → host loopback
maestro test e2e/maestro/record-results.yaml
maestro test e2e/maestro/search.yaml
```

The stub's behaviour (status, a 3-poll transcription, canned transcript and notes) is covered by
`e2e/__tests__/stub-server.test.ts`, so a stub that drifts from the contracts fails in jest, not on a device.
