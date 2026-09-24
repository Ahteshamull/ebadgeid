"use client";
import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// react-day-picker v9: modifiers (selected/today/outside/disabled/range_*)
// are applied to the <td> (UI.Day), not to the inner button, so a custom
// DayButton is needed to color the actual clickable element -- see
// node_modules/react-day-picker's DayPicker.js, which passes `modifiers`
// as a prop to DayButton for exactly this purpose.
function CalendarDayButton({ className, day, modifiers, ...props }) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    if (modifiers.focused) ref.current?.focus()
  }, [modifiers.focused])

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "h-8 w-8 p-0 font-normal aria-selected:opacity-100",
        modifiers.selected &&
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
        modifiers.today && !modifiers.selected && "bg-accent text-accent-foreground",
        (modifiers.outside || modifiers.disabled) && "text-muted-foreground opacity-50",
        modifiers.range_middle && "aria-selected:bg-accent aria-selected:text-accent-foreground",
        modifiers.hidden && "invisible",
        className
      )}
      {...props}
    />
  )
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute left-1"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 absolute right-1"
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...rest }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("h-4 w-4", chevronClassName)} {...rest} />
          ) : (
            <ChevronRight className={cn("h-4 w-4", chevronClassName)} {...rest} />
          ),
        DayButton: CalendarDayButton,
      }}
      {...props} />
  );
}
Calendar.displayName = "Calendar"

export { Calendar }
