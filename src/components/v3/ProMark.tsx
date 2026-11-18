import "../../styles/pricing.css";

/** The ORBES Trips Pro mark: "PRO" in the display capitals inside a gold hairline frame.
 *  sm = the size of a tag next to a word, md = a card's mark, lg = a double hairline, like a hallmark. */
export default function ProMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span className={"pro-mark pro-mark-" + size + (className ? " " + className : "")} role="img" aria-label="Pro">
      <span aria-hidden="true">PRO</span>
    </span>
  );
}
