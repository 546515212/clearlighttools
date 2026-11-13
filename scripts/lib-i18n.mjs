// Shared vocabulary for the two scripts that ask the same question from opposite ends:
//   i18n-wrap.mjs        — "is this literal a string a visitor reads, so it needs a dictionary key?"
//   check-note-literals  — "does this rendered slot still get its text from English written in code?"
// Keeping the answer in one file is the point: the rules drifted apart once already, and a check that
// disagrees with the codemod either cries wolf or hides the wolf.

// A dictionary call already in place: L('key', 'English') or t('key', 'English').
export const DICT_CALL = /\b[Lt]\s*\(\s*'[\w]+'\s*,\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)/g;

// Quoted code, not quoted English: `subject.split('\n')`, `' '.repeat(n)`, `x || ''`, `g === '∅'`,
// `shift > 0 ? '+' : '−'`. Folding these away is what lets a template that merely carries a sign or
// a whitespace run be recognised as a sentence — a literal with no letters or digits in it cannot be
// words a visitor needs translated. 'unknown' keeps its quotes: that one really is English.
const QUOTED = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
export function foldNonText(slice) {
  return slice.replace(QUOTED, (_, q, body) => {
    const cooked = body.replace(/\\[nrtbfv]/g, ' ').replace(/\\\\/g, ' ');
    return /[A-Za-z0-9\u00C0-\u024F]/.test(cooked) ? _ : 'D';
  });
}

// What is left once dictionary calls and quoted code are folded away. Anything still holding a quote
// is an English phrase parked where a translation pass will never reach it.
export function stillLiteral(slice) {
  return /["'`]/.test(foldNonText(slice.replace(DICT_CALL, 'D')));
}
