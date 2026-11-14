import type {
  AnimatedPropertyName,
  EditorLayerProperties,
} from '../../project/project.types';

type PropertyDefinition = {
  label: string;
  value: string;
  animationNames: AnimatedPropertyName[];
};

export function getProperties(layer: EditorLayerProperties): PropertyDefinition[] {
  return [
    {
      label: 'Anchor Point',
      value: `${(layer.anchorX ?? layer.width / 2).toFixed(1)} px, ${(layer.anchorY ?? layer.height / 2).toFixed(1)} px`,
      animationNames: ['anchorX', 'anchorY'],
    },
    {
      label: 'Position',
      value: `${layer.x.toFixed(1)} px, ${layer.y.toFixed(1)} px`,
      animationNames: ['positionX', 'positionY'],
    },
    {
      label: 'Scale',
      value: `${(layer.scaleX ?? 100).toFixed(1)}, ${(layer.scaleY ?? 100).toFixed(1)}%`,
      animationNames: ['scaleX', 'scaleY'],
    },
    {
      label: 'Rotation',
      value: `0x+${layer.rotation.toFixed(1)}°`,
      animationNames: ['rotation'],
    },
    {
      label: 'Opacity',
      value: `${layer.opacity.toFixed(0)}%`,
      animationNames: ['opacity'],
    },
  ];
}
