import { useState } from "react";
import { FaChevronDown, FaChevronUp } from "react-icons/fa";

const ChevronUp = FaChevronUp as unknown as React.FC;
const ChevronDown = FaChevronDown as unknown as React.FC;

type AccordionSectionProps = {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  subtitle?: string;
};

export default function AccordionSection({
  title,
  children,
  defaultOpen = false,
  subtitle,
}: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border rounded bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-between w-full px-4 py-3 text-left font-semibold bg-gray-100 hover:bg-gray-200"
        aria-expanded={isOpen}
      >
        <div className="flex flex-col">
          <span>{title}</span>
          {subtitle && (
            <span className="text-sm font-normal text-gray-500">{subtitle}</span>
          )}
        </div>
        <span className="ml-2">
          {isOpen ? <ChevronUp /> : <ChevronDown />}
        </span>
      </button>

      <div
        className={`transition-all duration-300 ease-in-out ${
          isOpen ? "max-h-screen opacity-100" : "max-h-0 opacity-0 overflow-hidden"
        }`}
      >
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
