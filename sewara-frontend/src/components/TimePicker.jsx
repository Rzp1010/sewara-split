"use client";

import { useEffect, useState } from "react";

function p2(n) {
  return String(n).padStart(2, "0");
}

/**
 * TimePicker - Native time input with real-world default
 * @param {Date|null} value - Current time value
 * @param {Function} onChange - Callback with Date object
 * @param {number} step - Step in seconds (default: 900 = 15 min)
 * @param {string} className - Additional CSS classes
 * @param {boolean} defaultNow - Use current time as default (default: true)
 */
export default function TimePicker({ 
  value, 
  onChange, 
  step = 900, 
  className = "",
  defaultNow = true,
  placeholder = "Pilih waktu"
}) {
  const [timeString, setTimeString] = useState("");

  // Initialize with current time or value
  useEffect(() => {
    if (value) {
      setTimeString(`${p2(value.getHours())}:${p2(value.getMinutes())}`);
    } else if (defaultNow) {
      const now = new Date();
      setTimeString(`${p2(now.getHours())}:${p2(now.getMinutes())}`);
    }
  }, [value, defaultNow]);

  function handleChange(e) {
    const newTime = e.target.value;
    setTimeString(newTime);

    if (!newTime) {
      onChange(null);
      return;
    }

    const [hours, minutes] = newTime.split(":").map(Number);
    const date = value ? new Date(value) : new Date();
    date.setHours(hours, minutes, 0, 0);
    onChange(date);
  }

  return (
    <input
      type="time"
      value={timeString}
      onChange={handleChange}
      step={step}
      placeholder={placeholder}
      className={`rounded-md border border-solid border-gray-300 bg-white px-3 py-2.5 text-sm focus:border-[#7181E0] focus:ring-2 focus:ring-[#7181E0]/20 ${className}`}
    />
  );
}
