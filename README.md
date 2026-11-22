[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Noman7860000/makefun-csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Noman7860000/makefun-csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# Fast CSV reader

A fast, dependency-free drop-in for csv-reader 1.0.0: `solve.js` answers every
case exactly as csv-reader does — the same `{columns, rows, errors}` for every
input `{text, header}`, including every broken-row quirk (stray CRs, quoted
line breaks, doubled quotes, quote junk, unterminated quotes, short and long
rows) — and does it with far less CPU time than the reference.

## How it works

One left-to-right scan, written to keep the hot path in native code:

- **Runs of unquoted fields are split whole** — each run of consecutive
  unquoted fields is sliced out and split on commas in one native call,
  instead of being read a character at a time. A run ends where a quoted
  field opens, where the record ends, or at the end of the text.
- **Other fields jump between delimiters with `indexOf`** — an unquoted field
  finds its next comma or line break and is sliced out whole; a quoted field
  finds its closing quote the same way. Only the rare paths (a stray CR, a
  line break inside quotes, a doubled quote) walk characters, and only over
  the few characters that need it.
- **Almost nothing is allocated per field** — the common paths are a slice
  and an array push; pieces are only joined when a field actually had
  something dropped or doubled inside it.
- **No caching between cases** — each case is answered alone, from its own
  text, and two runs of the program write byte-identical output.

`main.ts` is the program the harness runs (`node /bot/main.ts`, Node 22): it
reads every case from `/input/cases.json` (or `$MAKEFUN_INPUT_DIR`), answers
each with `run()`, and writes `/output/answers.json` (or
`$MAKEFUN_OUTPUT_DIR`). It turns V8's incremental marking off before importing
`solve.js`, the same way the house driver does. No network, no installs, no
WebAssembly, no native addons.

## Verify it locally

Against the kit's practice set (from the kit directory, with this repository
checked out as the bot):

```sh
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=/tmp/csv-out node main.ts
node -e "const a=require('/tmp/csv-out/answers.json'), e=require('<kit>/practice/reference/expected.json'); console.log(a.length, JSON.stringify(a)===JSON.stringify(e.cases.map(c=>c.output)))"
```

Or with the kit's own grader:

```sh
cd <kit>
node cli/makefun.mjs grade-local --kit . --bot <this repository> --driver process
```

## Files

- `solve.js` — the reader: `run(input)` returns csv-reader 1.0.0's answer.
- `main.ts` — the driver the harness runs.
- `LICENSE` — MIT.
