// A fast, dependency-free drop-in for csv-reader 1.0.0.
//
// Written from the published reading policy: one left-to-right scan of the
// text that returns exactly csv-reader's {columns, rows, errors} for every
// input {text, header}. Same answers, produced faster: instead of reading
// one character at a time and building each field a character at a time, it
// jumps between delimiters with indexOf, slices fields out whole, takes
// each run of unquoted fields in one native split, and only walks
// characters on the rare paths (a stray CR, a quoted line break, a doubled
// quote). Records with no quote and no stray CR are split whole as one run.
//
// The reading policy, kept exactly:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled, "" inside it is one quote, and each CRLF or lone CR inside
//     it is read as LF; what follows its closing quote, up to the next comma
//     or line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character and the text
//     after it is re-read as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     field count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met, a record's
//     short_row or long_row when it ends: line the 1-based line its record
//     starts on, counting every LF, CRLF and lone CR inside quotes, and row
//     its record's index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Each case is answered alone.

const COMMA = 1;
const LINE_BREAK = 2;
const END = 3;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The last field read: its value and how it ended.
  let fv = '';
  let fe = END;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at `start`, with `prefix` already in
  // the value ('' normally, the quoted value for quote junk, '"' for a quote
  // that never closes). Sets fv/fe, advances pos/line, records stray_cr.
  function readUnquoted(prefix, start) {
    let parts = null; // kept pieces before a stray CR, joined at the end
    let seg = start; // start of the piece still to slice
    let p = start; // where the next delimiter search starts
    while (true) {
      const c = text.indexOf(',', p);
      const l = text.indexOf('\n', p);
      let m;
      let kind;
      if (c === -1 && l === -1) {
        m = n;
        kind = END;
      } else if (c === -1) {
        m = l;
        kind = LINE_BREAK;
      } else if (l === -1) {
        m = c;
        kind = COMMA;
      } else if (c < l) {
        m = c;
        kind = COMMA;
      } else {
        m = l;
        kind = LINE_BREAK;
      }
      // The candidate piece is [seg, m). A CR inside it is a stray CR,
      // unless it is the piece's last character before a line break (CRLF).
      const cand = text.slice(seg, m);
      const r = cand.indexOf('\r');
      if (r !== -1 && !(kind === LINE_BREAK && r === cand.length - 1)) {
        err('stray_cr');
        if (parts === null) parts = [];
        parts.push(cand.slice(0, r));
        p = seg + r + 1;
        seg = p;
        continue;
      }
      const e = kind === LINE_BREAK && r === cand.length - 1 ? cand.slice(0, -1) : cand;
      fv = parts === null ? (prefix === '' ? e : prefix + e) : prefix + parts.join('') + e;
      if (kind === COMMA) {
        pos = m + 1;
        fe = COMMA;
      } else if (kind === LINE_BREAK) {
        pos = m + 1;
        line += 1;
        fe = LINE_BREAK;
      } else {
        pos = n;
        fe = END;
      }
      return;
    }
  }

  // The text of the quoted segment [a, b), with each CRLF and lone CR read
  // as LF; counts the line breaks it holds into `line`.
  function quotedSegment(a, b) {
    const seg = text.slice(a, b);
    const cr = seg.indexOf('\r');
    if (cr === -1) {
      let count = 0;
      let i = seg.indexOf('\n');
      while (i !== -1) {
        count += 1;
        i = seg.indexOf('\n', i + 1);
      }
      line += count;
      return seg;
    }
    let s = '';
    for (let i = 0; i < seg.length; i++) {
      const ch = seg.charCodeAt(i);
      if (ch === 13) {
        s += '\n';
        line += 1;
        if (seg.charCodeAt(i + 1) === 10) i += 1;
      } else {
        if (ch === 10) line += 1;
        s += seg[i];
      }
    }
    return s;
  }

  // Reads a quoted field whose opening quote is at `open`. Sets fv/fe.
  function readQuoted(open) {
    const openLine = line;
    let parts = null; // kept segments, joined at the end
    let scan = open + 1;
    let segStart = open + 1;
    while (true) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        line = openLine;
        err('unterminated_quote');
        readUnquoted('"', open + 1);
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        const seg = quotedSegment(segStart, q);
        if (parts === null) parts = [];
        parts.push(seg, '"');
        scan = q + 2;
        segStart = q + 2;
        continue;
      }
      // The closing quote.
      const seg = quotedSegment(segStart, q);
      const value = parts === null ? seg : parts.join('') + seg;
      pos = q + 1;
      if (pos >= n) {
        fv = value;
        fe = END;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fv = value;
        fe = COMMA;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fv = value;
        fe = LINE_BREAK;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fv = value;
        fe = LINE_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      readUnquoted(value, pos);
      if (fv.length > value.length) err('quote_junk');
      return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Read the record field by field, but take each run of unquoted fields
    // in one split instead of one read each. A run with no quote in it and
    // no stray CR is the whole rest of the record, split whole.
    const fields = [];
    let quoted = false;
    while (true) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        readQuoted(pos);
        fields.push(fv);
        if (fe !== COMMA) break;
        continue;
      }
      quoted = false;
      // The run of unquoted fields from pos: up to the next quoted field
      // (a quote that opens a field: one right after a comma — a quote
      // anywhere else in an unquoted field is a literal character), the
      // next line break (the record ends there) or the end of the text.
      // Quotes are found one at a time with a one-character search, but
      // only inside this line: searching the whole rest of the text for a
      // quote would re-scan every clean line that follows, which turns a
      // long quote-free stretch quadratic (measured ~16x slower than the
      // baseline on a quote-free file). The line's slice is taken once and
      // serves both the quote search and the run below.
      const l = text.indexOf('\n', pos);
      const limit = l === -1 ? n : l;
      const lineText = text.slice(pos, limit);
      let end;
      let endKind; // 1: quoted field, 2: line break, 3: end
      let qRel = lineText.indexOf('"');
      while (qRel !== -1 && text.charCodeAt(pos + qRel - 1) !== 44) {
        qRel = lineText.indexOf('"', qRel + 1);
      }
      if (qRel !== -1) {
        end = pos + qRel - 1;
        endKind = 1;
      } else if (l === -1) {
        end = n;
        endKind = 3;
      } else {
        end = l;
        endKind = 2;
      }
      const chunk = lineText.slice(0, end - pos);
      const rIdx = chunk.indexOf('\r');
      if (rIdx !== -1 && !(endKind === 2 && rIdx === chunk.length - 1)) {
        // A stray CR inside the run: read one field the slow way, which
        // drops it and records it, then take the run again.
        readUnquoted('', pos);
        fields.push(fv);
        if (fe !== COMMA) break;
        continue;
      }
      // No stray CR: split the run whole. A run ending at a quoted field
      // holds exactly its fields (its last comma stays outside the
      // slice); a run ending at a line break holds exactly the record's
      // remaining fields (minus a CRLF's CR).
      const runFields = endKind === 2 && rIdx === chunk.length - 1
        ? lineText.slice(0, end - pos - 1).split(',')
        : chunk.split(',');
      for (let i = 0; i < runFields.length; i++) fields.push(runFields[i]);
      if (endKind === 1) {
        pos = pos + qRel;
        continue;
      }
      if (endKind === 2) {
        pos = l + 1;
        line += 1;
      } else {
        pos = n;
      }
      break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
