import "../../styles/pricing.css";

/** The ORBES Trips Pro mark: "PRO" in the display capitals, white on a solid blue chip.
 *  sm = the size of a tag next to a word, md = a card's mark, lg = a hero's mark.
 *  The letters sit on the chip's optical centre: the tracking after the last letter is taken back, the capitals are centred on their cap height. */
export default function ProMark({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <span className={"pro-mark pro-mark-" + size + (className ? " " + className : "")} role="img" aria-label="Pro">
      <span aria-hidden="true">PRO</span>
    </span>
  );
}
