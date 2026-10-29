/** Red asterisk for required fields (announced as "required" to screen readers). */
export function RequiredMark() {
  return (
    <>
      <span aria-hidden="true" className="ml-0.5 font-semibold text-destructive">
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}
