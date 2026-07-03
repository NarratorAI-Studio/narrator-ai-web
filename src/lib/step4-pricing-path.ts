/**
 * Step 4 pricing path decider.
 *
 * Preset-template pricing depends on the Step 2 template source, not the
 * Step 1 material source. Custom material plus a preset template still needs
 * a template quote.
 */
export interface Step4PresetTemplateQuoteInput {
  /** True when Step 2 uses custom SRT instead of the template library. */
  useCustomTemplate: boolean;
  /** True when the user selected a template-library template. */
  hasConfirmedTemplate: boolean;
  /** Result of the relevant hard-price rollout flag. */
  hardPriceFlagEnabled: boolean;
}

export function shouldQuotePresetTemplateOnStep4(
  input: Step4PresetTemplateQuoteInput,
): boolean {
  return (
    !input.useCustomTemplate &&
    input.hasConfirmedTemplate &&
    input.hardPriceFlagEnabled
  );
}
