/**
 * Spear Item Component
 * Long spear with metal tip
 */

interface SpearProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  shaft: '#8B4513',
  shaftDark: '#654321',
  blade: '#C0C0C0',
  bladeEdge: '#E8E8E8',
  binding: '#1A1A1A',
};

export function Spear({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: SpearProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main shaft */}
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.035, 0.7, 0.035]} />
        <meshStandardMaterial color={COLORS.shaft} flatShading roughness={0.8} />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.25, 0]} castShadow>
        <boxGeometry args={[0.04, 0.12, 0.04]} />
        <meshStandardMaterial color={COLORS.shaftDark} flatShading roughness={0.7} />
      </mesh>

      {/* Spear head base */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <boxGeometry args={[0.05, 0.04, 0.05]} />
        <meshStandardMaterial color={COLORS.binding} flatShading roughness={0.6} />
      </mesh>

      {/* Spear head - main blade */}
      <mesh position={[0, 0.52, 0]} castShadow>
        <boxGeometry args={[0.04, 0.14, 0.02]} />
        <meshStandardMaterial color={COLORS.blade} flatShading metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Spear head - tip */}
      <mesh position={[0, 0.62, 0]} castShadow>
        <boxGeometry args={[0.025, 0.08, 0.015]} />
        <meshStandardMaterial color={COLORS.bladeEdge} flatShading metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Shaft end cap */}
      <mesh position={[0, -0.33, 0]} castShadow>
        <boxGeometry args={[0.04, 0.025, 0.04]} />
        <meshStandardMaterial color={COLORS.binding} flatShading roughness={0.6} />
      </mesh>
    </group>
  );
}

export default Spear;
