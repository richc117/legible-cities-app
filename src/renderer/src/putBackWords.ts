// What Put back says (issue 561, ADR-061): the three one-press resets'
// way back, and the line each section says once at the reset. In a module
// of its own, with no import, so the panels, their unit tests and an
// end-to-end spec all read the one copy of each sentence.
//
// Put back here is not the put-back of issue 360, which returns a control
// to the record after its build stopped (`usePutBack.ts`): this is a
// person's own step back from a reset, offered beside it.

/** Cell 05's Line colours: what puts back the colours the map was drawn in before Reset every line. */
export const PUT_BACK_COLOURS = 'Put back your colours'

/** Said once, politely, when Reset every line leaves something to put back. */
export const COLOURS_RESET_SAID =
  'Every line is back to its feed’s colour. Put back your colours to undo it.'

/** Cell 04's Sizes: what puts back the sizes the map was drawn with before the reset. */
export const PUT_BACK_SIZES = 'Put back your sizes'

/** Said once, politely, when Reset to the engine’s sizes leaves something to put back. */
export const SIZES_RESET_SAID =
  'The sizes are back to the engine’s own. Put back your sizes to undo it.'

/** Cell 02's Layout tuning: what writes the tuning the stored layout was laid out with. */
export const PUT_BACK_TUNING = 'Put back the tuning this layout was made with'

/** Said once, politely, while the tuning is LOOM's own and the layout was made with another. */
export const TUNING_RESET_SAID =
  'The tuning is back to LOOM’s defaults. Put back the tuning this layout was made with to undo it.'
