// A stand-in for the yt-dlp binary, driven by env vars so tests can steer
// stdout / stderr / exit code deterministically — no real yt-dlp, no network.
// The @distube/yt-dlp `json()` helper spawns YTDLP_PATH; the test sets that to
// Node's own executable and passes this script's path as the "url" argument,
// so `node fake-ytdlp.mjs …` runs here.
const out = process.env.FAKE_STDOUT ?? "";
const err = process.env.FAKE_STDERR ?? "";
if (out) process.stdout.write(out);
if (err) process.stderr.write(err);
process.exit(Number(process.env.FAKE_EXIT ?? "0"));
