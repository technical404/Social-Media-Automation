import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDUSTRIES, withCurrent } from "@/lib/planner";

const NONE = "__none__";

/** Industry dropdown shared by the client, calendar and AI-planning forms. */
export function IndustrySelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}>
      <SelectTrigger id={id} aria-label="Industry">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Not set</SelectItem>
        {withCurrent(INDUSTRIES, value).map((industry) => (
          <SelectItem key={industry} value={industry}>
            {industry}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
