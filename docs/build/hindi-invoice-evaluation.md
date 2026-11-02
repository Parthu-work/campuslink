# Hindi invoices: evaluation (prompt 1b, R9)

**Date:** 2 November 2026. **Asked by:** the owner, in the prompt 1b session. **Result:** invoices and credit notes stay in English. A Hindi copy is feasible, but it is built only after a native speaker checks a prototype's conjuncts and vowel signs, and none has been available.

## Why B12 kept invoices in English

Invoices are drawn with `pdf-lib` and `@pdf-lib/fontkit` (`apps/api/src/modules/billing/invoice-pdf.ts`). Devanagari needs shaping: conjuncts (क्ष, द्ध), the reph (र्), the short i-matra drawn before its consonant, and marks placed above or below a letter (anusvara, chandrabindu, nukta, some matras).

## What was measured

A script compared the current path with HarfBuzz (`harfbuzzjs` 0.4.7, HarfBuzz compiled to WebAssembly, 197 KB, MIT with an Apache-licensed libc part) on nine invoice phrases: "कर बीजक", "क्रेडिट नोट", "बीजक की तारीख़", "देय तिथि", "आपूर्ति का स्थान", an amount in words ("अठासी हज़ार पाँच सौ रुपये मात्र"), and three phrases chosen for conjuncts, reph with i-matra, and nukta with chandrabindu. The font was Nirmala UI (the Windows Devanagari font, used for the measurement only; a shipped version would embed Noto Sans Devanagari, SIL Open Font Licence, like the Latin font today). The script and its scratch dependencies stayed outside the repository.

| Finding                                        | Detail                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The current path cannot draw Hindi at all**  | `@pdf-lib/fontkit` 1.1.1's Indic shaper throws `ReferenceError: regeneratorRuntime is not defined`: the bundle leaves out the generator runtime its Devanagari shaper needs. Any invoice with Devanagari text would fail to render.                                                      |
| **Glyph choice is right once that is patched** | With `regenerator-runtime` loaded first, fontkit picks exactly the glyphs HarfBuzz picks in all nine phrases (same count and ids): conjuncts, reph and i-matra reordering are correct.                                                                                                   |
| **Mark positions are lost**                    | In eight of the nine phrases at least one glyph (nine in all) needs a positional offset (marks placed above or below a letter). Both shapers report these offsets, but `pdf-lib`'s `drawText` keeps only glyph ids and advance widths, so those marks would be drawn at the wrong place. |

## What a Hindi copy would take

1. Draw Devanagari runs glyph by glyph with their offsets: shape the text (fontkit with `regenerator-runtime`, or HarfBuzz for a second opinion), then place each glyph with its x and y offset through `pdf-lib`'s low-level operators (`beginText`, `setTextMatrix`, `showText` with the glyph id) instead of `drawText`. Embed the Devanagari font without subsetting, or mark the drawn glyphs as used, because glyphs drawn this way bypass `pdf-lib`'s subset tracking.
2. Keep English as the legal copy: the Hindi page is an extra page or a separate download, numbered and dated the same, saying the English one prevails.
3. A native Hindi speaker checks a sample PDF (the nine phrases above, the college's legal name and address in Hindi, and amounts in words), particularly conjuncts and vowel signs, before it ships (O7).
4. Hindi amounts in words need their own function (lakh and crore words in Hindi); `rupeesInWords` is English.

## Decision

Not built. The prototype is cheap, but the prompt allows it only after a native speaker's check, and a Hindi invoice is not needed for GST compliance (an English invoice is valid). Recorded for the owner with O5 and O7: if a college asks for Hindi invoices, build steps 1 to 4 and have the sample checked.
