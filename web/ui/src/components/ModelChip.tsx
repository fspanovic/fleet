import { CpuIcon } from 'lucide-react'

import { ModelPicker, canPickModel, type ModelPickerTarget } from '@/components/ModelPicker'
import { modelLabel } from '@/lib/format'
import { CHIP, MODEL_CHIP } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * The model a session runs (`context.model`): chip icon + `Opus 5.5`, the full id on hover. Nothing when unknown.
 * With `picker` (a live Claude session), a click opens the model picker (ModelPicker).
 */
export function ModelChip({ model, className, picker }: { model?: string | null; className?: string; picker?: ModelPickerTarget }) {
  const label = modelLabel(model)
  if (!label) return null
  const body = (
    <>
      <CpuIcon className="size-3 shrink-0" aria-hidden />
      {label}
    </>
  )
  if (picker && canPickModel(picker)) {
    return (
      <ModelPicker target={picker} model={model} label={label} className={cn(CHIP, MODEL_CHIP, className)}>
        {body}
      </ModelPicker>
    )
  }
  return (
    <span title={`Model: ${model}`} aria-label={`Model ${label}`} className={cn(CHIP, MODEL_CHIP, className)}>
      {body}
    </span>
  )
}
