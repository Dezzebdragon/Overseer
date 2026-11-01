import { SWATCHES } from '../trackerTypes'

export function ColorSwatches({
  value,
  onPick
}: {
  value?: string
  onPick: (color: string) => void
}): JSX.Element {
  return (
    <div className="swatches">
      {SWATCHES.map((color) => (
        <button
          key={color}
          className={`swatch${value === color ? ' active' : ''}`}
          style={{ background: color }}
          onClick={() => onPick(color)}
          aria-label={`Use color ${color}`}
        />
      ))}
    </div>
  )
}
