/**
 * Dagger Item Component
 * Short blade for quick attacks
 */

interface DaggerProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  blade: '#C0C0C0',
  bladeEdge: '#E8E8E8',
  handle: '#8B4513',
  guard: '#FFD700',
  pommel: '#FFD700',
};

export function Dagger({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: DaggerProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Blade */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.025, 0.22, 0.015]} />
        <meshStandardMaterial color={COLORS.blade} flatShading metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Blade tip */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.02, 0.05, 0.012]} />
        <meshStandardMaterial color={COLORS.bladeEdge} flatShading metalness={0.7} roughness={0.3} />
      </mesh>

      {/* Guard */}
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.08, 0.025, 0.03]} />
        <meshStandardMaterial color={COLORS.guard} flatShading metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Handle */}
      <mesh position={[0, -0.08, 0]} castShadow>
        <boxGeometry args={[0.035, 0.12, 0.035]} />
        <meshStandardMaterial color={COLORS.handle} flatShading roughness={0.8} />
      </mesh>

      {/* Pommel */}
      <mesh position={[0, -0.16, 0]} castShadow>
        <boxGeometry args={[0.04, 0.03, 0.04]} />
        <meshStandardMaterial color={COLORS.pommel} flatShading metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

export default Dagger;
