import { useState } from 'react';
import { ChevronDown, Link2, Timer } from 'lucide-react';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  LayerAnimation,
} from '../../project/project.types';
import { getProperties } from './TimelinePropertyData';
import NumberScrubField from '../components/NumberScrubField';

export function PropertyRows({
  layer,
  animation,
  onLiveChange,
  onBeginEdit,
  onDeleteKeyframes,
}: {
  layer: EditorLayerProperties;
  animation: LayerAnimation | undefined;
  onLiveChange: (
    updates: Partial<EditorLayerProperties>,
    keyframeProperties?: AnimatedPropertyName[],
  ) => void;
  onBeginEdit: () => () => void;
  onDeleteKeyframes: (propertyNames: AnimatedPropertyName[]) => void;
}) {
  const [scaleLinked, setScaleLinked] = useState(true);
  return (
    <>
      <div className="tl-property-row">
        <span className="tl-property-indent" />
        <span className="tl-property-content tl-transform-heading">
          <ChevronDown size={10} />
          <span>Transform</span>
          <button type="button" disabled={layer.locked}>Reset</button>
        </span>
      </div>
      {getProperties(layer).map((property) => {
        const keyframes = property.animationNames.flatMap(
          (name) => animation?.properties[name]?.keyframes ?? [],
        );
        const isAnimated = keyframes.length > 0;
        const isArmed = isAnimated;
        const toggleStopwatch = () => {
          if (isArmed) {
            if (isAnimated && !window.confirm(`Delete all ${property.label} keyframes?`)) return;
            if (isAnimated) onDeleteKeyframes(property.animationNames);
            return;
          }

          const updates: Partial<EditorLayerProperties> = {};
          const values: Partial<Record<AnimatedPropertyName, number>> = {};
          if (property.label === 'Anchor Point') {
            updates.anchorX = layer.anchorX ?? layer.width / 2;
            updates.anchorY = layer.anchorY ?? layer.height / 2;
            values.anchorX = updates.anchorX;
            values.anchorY = updates.anchorY;
          } else if (property.label === 'Position') {
            updates.x = layer.x;
            updates.y = layer.y;
            values.positionX = layer.x;
            values.positionY = layer.y;
          } else if (property.label === 'Scale') {
            updates.scaleX = layer.scaleX ?? 100;
            updates.scaleY = layer.scaleY ?? 100;
            values.scaleX = updates.scaleX;
            values.scaleY = updates.scaleY;
          } else if (property.label === 'Rotation') {
            updates.rotation = layer.rotation;
            values.rotation = layer.rotation;
          } else if (property.label === 'Opacity') {
            updates.opacity = layer.opacity;
            values.opacity = layer.opacity;
          }
          onBeginEdit();
          onLiveChange(
            updates,
            property.animationNames.filter((name) => values[name] !== undefined),
          );
        };
        return (
          <div className="tl-property-row" key={property.label}>
            <span className="tl-property-indent" />
            <span className="tl-property-content">
              <span className="tl-key-nav" aria-hidden={!isAnimated}>
                {isAnimated ? '‹ ◇ ›' : ''}
              </span>
              <button
                type="button"
                className={`tl-stopwatch ${isArmed ? 'is-animated' : 'is-dim'}`}
                title={isArmed ? 'Stop keyframing this property' : 'Enable keyframing for this property'}
                aria-label={`${isArmed ? 'Disable' : 'Enable'} ${property.label} keyframing`}
                aria-pressed={isArmed}
                disabled={layer.locked}
                onClick={toggleStopwatch}
              >
                <Timer size={11} />
              </button>
              {isAnimated && <span className="tl-property-graph">⌁</span>}
              <span className="tl-property-label">{property.label}</span>
              {property.label === 'Scale' && (
                <button
                  type="button"
                  className={`tl-chain ${scaleLinked ? 'is-linked' : ''}`}
                  aria-label={scaleLinked ? 'Unlock scale proportions' : 'Lock scale proportions'}
                  aria-pressed={scaleLinked}
                  disabled={layer.locked}
                  onClick={() => setScaleLinked((linked) => !linked)}
                >
                  <Link2 size={11} />
                </button>
              )}
              <span className="tl-property-value">
                {property.label === 'Anchor Point' && (
                  <>
                    <NumberScrubField label="Anchor X" value={layer.anchorX ?? layer.width / 2} unit="px" disabled={layer.locked} onBeginEdit={onBeginEdit} onChange={(anchorX) => onLiveChange({ anchorX }, isAnimated ? ['anchorX'] : undefined)} />
                    <span>, </span>
                    <NumberScrubField label="Anchor Y" value={layer.anchorY ?? layer.height / 2} unit="px" disabled={layer.locked} onBeginEdit={onBeginEdit} onChange={(anchorY) => onLiveChange({ anchorY }, isAnimated ? ['anchorY'] : undefined)} />
                  </>
                )}
                {property.label === 'Position' && (
                  <>
                    <NumberScrubField label="Position X" value={layer.x} unit="px" disabled={layer.locked} onBeginEdit={onBeginEdit} onChange={(x) => onLiveChange({ x }, isAnimated ? ['positionX'] : undefined)} />
                    <span>, </span>
                    <NumberScrubField label="Position Y" value={layer.y} unit="px" disabled={layer.locked} onBeginEdit={onBeginEdit} onChange={(y) => onLiveChange({ y }, isAnimated ? ['positionY'] : undefined)} />
                  </>
                )}
                {property.label === 'Scale' && (
                  <>
                    <NumberScrubField
                      label="Scale X"
                      value={layer.scaleX ?? 100}
                      unit="%"
                      disabled={layer.locked}
                      onBeginEdit={onBeginEdit}
                      onChange={(scaleX) => {
                        const scaleY = scaleLinked
                          ? (layer.scaleX ?? 100) === 0
                            ? scaleX
                            : (layer.scaleY ?? 100) * scaleX / (layer.scaleX ?? 100)
                          : undefined;
                        onLiveChange(
                          scaleY === undefined ? { scaleX } : { scaleX, scaleY },
                          isAnimated
                            ? scaleLinked ? ['scaleX', 'scaleY'] : ['scaleX']
                            : undefined,
                        );
                      }}
                    />
                    <span>, </span>
                    <NumberScrubField
                      label="Scale Y"
                      value={layer.scaleY ?? 100}
                      unit="%"
                      disabled={layer.locked}
                      onBeginEdit={onBeginEdit}
                      onChange={(scaleY) => {
                        const scaleX = scaleLinked
                          ? (layer.scaleY ?? 100) === 0
                            ? scaleY
                            : (layer.scaleX ?? 100) * scaleY / (layer.scaleY ?? 100)
                          : undefined;
                        onLiveChange(
                          scaleX === undefined ? { scaleY } : { scaleX, scaleY },
                          isAnimated
                            ? scaleLinked ? ['scaleX', 'scaleY'] : ['scaleY']
                            : undefined,
                        );
                      }}
                    />
                  </>
                )}
                {property.label === 'Rotation' && (
                  <NumberScrubField
                    label="Rotation"
                    value={layer.rotation}
                    disabled={layer.locked}
                    format={(value) => `${Math.trunc(value / 360)}x${value % 360 >= 0 ? '+' : ''}${(value % 360).toFixed(1)}°`}
                    onBeginEdit={onBeginEdit}
                    onChange={(rotation) => onLiveChange({ rotation }, isAnimated ? ['rotation'] : undefined)}
                  />
                )}
                {property.label === 'Opacity' && (
                  <NumberScrubField label="Opacity" value={layer.opacity} unit="%" min={0} max={100} disabled={layer.locked} onBeginEdit={onBeginEdit} onChange={(opacity) => onLiveChange({ opacity }, isAnimated ? ['opacity'] : undefined)} />
                )}
              </span>
            </span>
            <span className="tl-property-expression">◉</span>
          </div>
        );
      })}
    </>
  );
}
