/**
 * Wrench Item Component
 * Adjustable wrench tool
 */

interface WrenchProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  metal: '#4B5563',
  metalLight: '#6B7280',
  grip: '#1A1A1A',
  gripAccent: '#374151',
};

export function Wrench({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: WrenchProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Handle shaft */}
      <mesh position={[0, -0.02, 0]} castShadow>
        <boxGeometry args={[0.04, 0.28, 0.02]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.12, 0]} castShadow>
        <boxGeometry args={[0.05, 0.12, 0.025]} />
        <meshStandardMaterial color={COLORS.grip} flatShading roughness={0.8} />
      </mesh>

      {/* Grip texture lines */}
      <mesh position={[0, -0.1, 0.013]} castShadow>
        <boxGeometry args={[0.045, 0.08, 0.005]} />
        <meshStandardMaterial color={COLORS.gripAccent} flatShading roughness={0.7} />
      </mesh>

      {/* Wrench head - fixed jaw */}
      <mesh position={[0.025, 0.18, 0]} castShadow>
        <boxGeometry args={[0.05, 0.1, 0.025]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Wrench head - movable jaw */}
      <mesh position={[-0.025, 0.2, 0]} castShadow>
        <boxGeometry args={[0.04, 0.08, 0.025]} />
        <meshStandardMaterial color={COLORS.metalLight} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Adjustment wheel */}
      <mesh position={[0, 0.14, 0]} castShadow>
        <boxGeometry args={[0.06, 0.025, 0.03]} />
        <meshStandardMaterial color={COLORS.metalLight} flatShading metalness={0.5} roughness={0.5} />
      </mesh>
    </group>
  );
}

export default Wrench;
