import { cn } from "@/lib/utils"
import { IconSpinner } from "@/components/icons";

function Spinner({ className, ...props }: React.ComponentProps<typeof IconSpinner>) {
  return (
    <IconSpinner
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
