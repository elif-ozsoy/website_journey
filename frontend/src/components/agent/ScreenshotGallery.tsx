import { useState } from "react";
import { AgentStep } from "./agentTypes";
import ScreenshotCard from "./ScreenshotCard.tsx";

interface Props { steps: AgentStep[]; selectedStep: number | null; onSelectStep: (n: number | null) => void; }

export default function ScreenshotGallery({ steps, selectedStep, onSelectStep }: Props) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const handleCardClick = (step: AgentStep) => {
    const n = step.step_number;
    if (expandedStep === n) { setExpandedStep(null); onSelectStep(null); }
    else { setExpandedStep(n); onSelectStep(n); }
  };

  if (steps.length === 0) return <div className="flex items-center justify-center h-64 text-gray-500">No screenshots yet...</div>;

  return (
    <div className="p-4">
      {expandedStep !== null && (
        <div className="mb-6">
          {steps.filter((s) => s.step_number === expandedStep).map((step) => (
            <ScreenshotCard key={step.step_number} step={step} isExpanded onClick={() => handleCardClick(step)} />
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {steps.map((step) => (
          <ScreenshotCard key={step.step_number} step={step} isExpanded={false} isSelected={selectedStep === step.step_number} onClick={() => handleCardClick(step)} />
        ))}
      </div>
    </div>
  );
}