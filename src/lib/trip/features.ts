// Feature flags for surfaces that are built and tested but not currently shown.

/**
 * The allergenic-tree ("pollen") axis. The measurement, the tile format that
 * carries each tree's pollen class, the Pollen-sensitive profile and the
 * assistant's answers are all intact — this flag only controls whether any of
 * it reaches the UI.
 *
 * Off because the axis measures species composition within 50 m while pollen
 * travels hundreds of metres, tree sex is not recorded, and there is no NYC
 * pollen data to validate against. See "Allergenic tree species" in
 * docs/HOW-IT-WORKS.md for the full reasoning.
 *
 * Turning this on also means restoring the 0.1 pollen weight on the Asthma
 * profile in score.ts, which was folded back into air and traffic when the
 * axis was hidden: a weight the user cannot see is a weight they cannot
 * question.
 */
export const SHOW_POLLEN = false;
