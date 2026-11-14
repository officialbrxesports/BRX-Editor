
import { useState } from 'react';
import {
  FlipHorizontal,
  FlipVertical,
  Image,
  Layers3,
  Lock,
  Link2,
  RotateCw,
  SlidersHorizontal,
  Timer,
  Unlock,
} from 'lucide-react';
import type { AnimatedPropertyName, EditorLayerProperties } from '../../project/project.types';
import NumberScrubField from './NumberScrubField';
import './PropertiesExtras.css';


type PropertiesPanelProps = {
  selectedLayer?: EditorLayerProperties | null;
  onChange?: (
    updates: Partial<EditorLayerProperties>,
  ) => void;
  onLiveChange?: (
    updates: Partial<EditorLayerProperties>,
    keyframeProperties?: AnimatedPropertyName[],
  ) => void;
  onBeginEdit?: () => () => void;
  onFlip?: (axis: 'horizontal' | 'vertical') => void;
};

type NumberFieldOptions = {
  label: string;
  value: number;
  field: keyof EditorLayerProperties;
  unit?: string;
  min?: number;
  max?: number;
  rate?: number;
  format?: (value: number) => string;
  disabled?: boolean;
};

function PropertyNumberField({
  label,
  value,
  unit,
  min,
  max,
  rate = 1,
  format,
  disabled,
  armed,
  onToggleArmed,
  onBeginEdit,
  onScrubChange,
}: NumberFieldOptions & {
  armed: boolean;
  onToggleArmed: () => void;
  onBeginEdit: () => () => void;
  onScrubChange: (value: number) => void;
}) {
  return (
    <div className="property-field">
      <span>{label}</span>
      <div className="property-input-wrap">
        <button
          type="button"
          className={`property-stopwatch ${armed ? 'is-armed' : ''}`}
          title={armed ? 'Stop keyframing this property' : 'Enable keyframing for this property'}
          aria-label={armed ? `Disable ${label} keyframing` : `Enable ${label} keyframing`}
          aria-pressed={armed}
          disabled={disabled}
          onClick={onToggleArmed}
        >
          <Timer size={12} />
        </button>
        <NumberScrubField
          label={label}
          value={value}
          unit={unit}
          rate={rate}
          min={min}
          max={max}
          format={format}
          disabled={disabled}
          onBeginEdit={onBeginEdit}
          onChange={onScrubChange}
        />
      </div>
    </div>
  );
}

export default function PropertiesPanel({
  selectedLayer = null,
  onChange,
  onLiveChange,
  onBeginEdit = () => () => {},
  onFlip,
}: PropertiesPanelProps) {
  const [scaleLinked, setScaleLinked] = useState(true);
  const [armedFields, setArmedFields] = useState<Set<keyof EditorLayerProperties>>(() => new Set());
  if (!selectedLayer) {
    return (
      <aside className="properties-panel">
        <div className="panel-header">
          <h3>Properties</h3>
        </div>

        <div className="properties-empty">
          <div className="properties-empty-icon">
            <Layers3 size={27} />
          </div>

          <h3>No Layer Selected</h3>
          <p>
            Select a layer in the timeline to edit its properties.
          </p>
        </div>
      </aside>
    );
  }

  const update = (
    key: keyof EditorLayerProperties,
    value: number | string | boolean,
  ) => {
    onChange?.({ [key]: value });
  };

  const renderNumberField = (options: NumberFieldOptions) => (
    <PropertyNumberField
      {...options}
      key={options.field}
      disabled={selectedLayer.locked}
      armed={armedFields.has(options.field)}
      onToggleArmed={() => setArmedFields((current) => {
        const next = new Set(current);
        if (next.has(options.field)) next.delete(options.field);
        else next.add(options.field);
        return next;
      })}
      onBeginEdit={onBeginEdit}
      onScrubChange={(next) => {
        const field = options.field;
        if (field === 'scaleX' && scaleLinked) {
          const scaleX = selectedLayer.scaleX ?? 100;
          onLiveChange?.({
            scaleX: next,
            scaleY: scaleX === 0 ? next : (selectedLayer.scaleY ?? 100) * next / scaleX,
          }, armedFields.has(field) ? ['scaleX', 'scaleY'] : undefined);
        } else if (field === 'scaleY' && scaleLinked) {
          const scaleY = selectedLayer.scaleY ?? 100;
          onLiveChange?.({
            scaleY: next,
            scaleX: scaleY === 0 ? next : (selectedLayer.scaleX ?? 100) * next / scaleY,
          }, armedFields.has(field) ? ['scaleX', 'scaleY'] : undefined);
        } else {
          const animationName: Partial<Record<keyof EditorLayerProperties, AnimatedPropertyName>> = {
            x: 'positionX',
            y: 'positionY',
            scaleX: 'scaleX',
            scaleY: 'scaleY',
            rotation: 'rotation',
            opacity: 'opacity',
            anchorX: 'anchorX',
            anchorY: 'anchorY',
          };
          const name = animationName[field];
          onLiveChange?.(
            { [field]: next },
            armedFields.has(field) && name ? [name] : undefined,
          );
        }
      }}
    />
  );

  return (
    <aside className="properties-panel">
      <div className="panel-header">
        <h3>Properties</h3>

        <span className="selected-layer-badge">
          Selected
        </span>
      </div>

      <div className="properties-layer-info">
        <div className="layer-preview-icon">
          <Image size={19} />
        </div>

        <div className="layer-info-text">
          <strong>{selectedLayer.name}</strong>
          <span>{selectedLayer.type}</span>
        </div>

        <button
          className="panel-icon-button"
          type="button"
          title={selectedLayer.locked ? 'Unlock layer' : 'Lock layer'}
          onClick={() =>
            update('locked', !selectedLayer.locked)
          }
        >
          {selectedLayer.locked ? (
            <Lock size={17} />
          ) : (
            <Unlock size={17} />
          )}
        </button>
      </div>

      <div className="property-section">
        <div className="property-section-heading">
          <Layers3 size={16} />
          <h4>Transform</h4>
        </div>

        <div className="property-grid">
          {renderNumberField({
            label: 'Position X',
            value: selectedLayer.x,
            field: 'x',
            unit: 'px',
          })}

          {renderNumberField({ label: 'Position Y', value: selectedLayer.y, field: 'y', unit: 'px' })}

          {renderNumberField({ label: 'Width', value: selectedLayer.width, field: 'width', unit: 'px' })}

          {renderNumberField({ label: 'Height', value: selectedLayer.height, field: 'height', unit: 'px' })}
          {renderNumberField({ label: 'Anchor X', value: selectedLayer.anchorX ?? selectedLayer.width / 2, field: 'anchorX', unit: 'px' })}
          {renderNumberField({ label: 'Anchor Y', value: selectedLayer.anchorY ?? selectedLayer.height / 2, field: 'anchorY', unit: 'px' })}
          <div className="property-section-heading property-scale-heading">
            <h4>Scale</h4>
            <button
              type="button"
              className={`panel-icon-button ${scaleLinked ? 'is-active' : ''}`}
              title={scaleLinked ? 'Unlock scale proportions' : 'Lock scale proportions'}
              aria-label={scaleLinked ? 'Unlock scale proportions' : 'Lock scale proportions'}
              aria-pressed={scaleLinked}
              onClick={() => setScaleLinked((linked) => !linked)}
            >
              <Link2 size={14} />
            </button>
          </div>
          {renderNumberField({ label: 'Scale X', value: selectedLayer.scaleX ?? 100, field: 'scaleX', unit: '%', rate: 1 })}
          {renderNumberField({ label: 'Scale Y', value: selectedLayer.scaleY ?? 100, field: 'scaleY', unit: '%', rate: 1 })}
          <div className="property-flip-row">
            <button
              type="button"
              className="property-flip-button"
              title="Flip Horizontal (mirror left-right)"
              aria-label="Flip Horizontal"
              disabled={selectedLayer.locked}
              onClick={() => onFlip?.('horizontal')}
            >
              <FlipHorizontal size={14} />
              <span>Flip H</span>
            </button>
            <button
              type="button"
              className="property-flip-button"
              title="Flip Vertical (mirror top-bottom)"
              aria-label="Flip Vertical"
              disabled={selectedLayer.locked}
              onClick={() => onFlip?.('vertical')}
            >
              <FlipVertical size={14} />
              <span>Flip V</span>
            </button>
          </div>
          {(selectedLayer.type === 'image' || selectedLayer.type === 'video') && (
            <div className="property-field property-border-field">
              <span>Border Mode</span>
              <select
                className="property-select"
                aria-label="Border Mode"
                title="What is drawn outside the layer rectangle"
                value={selectedLayer.borderMode ?? 'clamp'}
                disabled={selectedLayer.locked}
                onChange={(event) => update('borderMode', event.currentTarget.value)}
              >
                <option value="clamp">Clamp</option>
                <option value="extend">Extend</option>
                <option value="mirror">Mirror</option>
              </select>
            </div>
          )}
          {selectedLayer.threeDLayer && renderNumberField({ label: 'Position Z', value: selectedLayer.z ?? 0, field: 'z', unit: 'px' })}
          {selectedLayer.threeDLayer && renderNumberField({ label: 'Scale Z', value: selectedLayer.scaleZ ?? 100, field: 'scaleZ', unit: '%' })}
        </div>
      </div>

      {(selectedLayer.type === 'adjustment' || selectedLayer.adjustmentLayer) && (
        <div className="property-section">
          <div className="property-section-heading">
            <SlidersHorizontal size={16} />
            <h4>Adjustment Layer</h4>
          </div>
          <div className="property-field">
            <span>Apply To</span>
            <select
              className="property-select"
              aria-label="Apply To"
              value={selectedLayer.applyTo ?? 'all-below'}
              disabled={selectedLayer.locked}
              onChange={(event) => update('applyTo', event.currentTarget.value)}
            >
              <option value="all-below">All Layers Below</option>
              <option value="layer-below">Layer Below</option>
            </select>
          </div>
        </div>
      )}

      {selectedLayer.threeDLayer && (
        <div className="property-section">
          <div className="property-section-heading">
            <RotateCw size={16} />
            <h4>3D Orientation &amp; Rotation</h4>
          </div>
          <div className="property-grid">
            {renderNumberField({ label: 'Orientation X', value: selectedLayer.orientationX ?? 0, field: 'orientationX', unit: '°' })}
            {renderNumberField({ label: 'Orientation Y', value: selectedLayer.orientationY ?? 0, field: 'orientationY', unit: '°' })}
            {renderNumberField({ label: 'Orientation Z', value: selectedLayer.orientationZ ?? 0, field: 'orientationZ', unit: '°' })}
            {renderNumberField({ label: 'X Rotation', value: selectedLayer.rotationX ?? 0, field: 'rotationX', unit: '°' })}
            {renderNumberField({ label: 'Y Rotation', value: selectedLayer.rotationY ?? 0, field: 'rotationY', unit: '°' })}
            {renderNumberField({ label: 'Z Rotation', value: selectedLayer.rotation, field: 'rotation', unit: '°' })}
          </div>
        </div>
      )}

      <div className="property-section">
        <div className="property-section-heading">
          <RotateCw size={16} />
          <h4>Rotation</h4>
        </div>

        {renderNumberField({
          label: 'Angle',
          value: selectedLayer.rotation,
          field: 'rotation',
          format: (value) => `${Math.trunc(value / 360)}x${value % 360 >= 0 ? '+' : ''}${(value % 360).toFixed(1)}°`,
        })}
      </div>

      <div className="property-section">
        <div className="property-section-heading">
          <h4>Opacity</h4>
          <strong className="property-input-wrap">
            <button
              type="button"
              className={`property-stopwatch ${armedFields.has('opacity') ? 'is-armed' : ''}`}
              title={armedFields.has('opacity') ? 'Stop keyframing opacity' : 'Enable opacity keyframing'}
              aria-pressed={armedFields.has('opacity')}
              onClick={() => setArmedFields((current) => {
                const next = new Set(current);
                if (next.has('opacity')) next.delete('opacity');
                else next.add('opacity');
                return next;
              })}
            >
              <Timer size={12} />
            </button>
            <NumberScrubField
              label="Opacity"
              value={selectedLayer.opacity}
              unit="%"
              min={0}
              max={100}
              onBeginEdit={onBeginEdit}
              onChange={(opacity) =>               onLiveChange?.(
                { opacity },
                armedFields.has('opacity') ? ['opacity'] : undefined,
              )}
            />
          </strong>
        </div>

        <input
          className="property-range"
          type="range"
          min={0}
          max={100}
          value={selectedLayer.opacity}
          onChange={(event) =>
            update('opacity', Number(event.target.value))
          }
          aria-label="Layer opacity"
        />

        <div className="property-range-labels">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>
    </aside>
  );
}
