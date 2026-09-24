'use client';

import { useState, useEffect } from 'react';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export function DatePicker({ selected, onSelect, minDate, className }) {
  const [date, setDate] = useState(selected ? new Date(selected) : undefined);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

  useEffect(() => {
    if (selected) {
      setDate(new Date(selected));
    }
  }, [selected]);

  const handleSelect = (selectedDate) => {
    if (!selectedDate) return;
    
    setDate(selectedDate);
    onSelect(selectedDate.toISOString());
    setIsPopoverOpen(false);
  };

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={"outline"}
          className={cn(
            "w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {date ? format(date, "PPP") : <span>Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={date}
          onSelect={handleSelect}
          autoFocus
          disabled={minDate ? { before: new Date(minDate) } : undefined}
        />
      </PopoverContent>
    </Popover>
  );
}