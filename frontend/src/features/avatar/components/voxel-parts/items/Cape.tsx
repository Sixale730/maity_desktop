/**
 * Cape Item Component
 * Hero cape that flows behind the character
 */

interface CapeProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
  color?: string;
}

const DEFAULT_COLOR = '#DC2626'; // Red cape

export function Cape({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
  color = DEFAULT_COLOR,
}: CapeProps) {
  // Darken color for inner side
  const innerColor = '#1A1A1A';

  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Cape collar */}
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[0.5, 0.08, 0.12]} />
        <meshStandardMaterial
          color={color}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Cape upper section */}
      <mesh position={[0, 0.12, -0.04]} castShadow>
        <boxGeometry args={[0.55, 0.2, 0.06]} />
        <meshStandardMaterial
          color={color}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Cape middle section (wider) */}
      <mesh position={[0, -0.08, -0.06]} castShadow>
        <boxGeometry args={[0.6, 0.22, 0.05]} />
        <meshStandardMaterial
          color={color}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Cape lower section (widest) */}
      <mesh position={[0, -0.28, -0.08]} castShadow>
        <boxGeometry args={[0.65, 0.2, 0.04]} />
        <meshStandardMaterial
          color={color}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Cape bottom edge */}
      <mesh position={[0, -0.42, -0.09]} castShadow>
        <boxGeometry args={[0.6, 0.1, 0.03]} />
        <meshStandardMaterial
          color={color}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Inner lining (dark) */}
      <mesh position={[0, -0.1, 0.01]} castShadow>
        <boxGeometry args={[0.5, 0.5, 0.02]} />
        <meshStandardMaterial
          color={innerColor}
          flatShading
          roughness={0.9}
        />
      </mesh>
    </group>
  );
}

export default Cape;
