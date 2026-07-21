/**
 * Shovel Item Component
 * Digging tool with flat blade
 */

interface ShovelProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  metal: '#607D8B',
  metalEdge: '#78909C',
  handle: '#8B4513',
  handleDark: '#654321',
};

export function Shovel({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: ShovelProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Handle */}
      <mesh position={[0, 0.0, 0]} castShadow>
        <boxGeometry args={[0.035, 0.4, 0.035]} />
        <meshStandardMaterial color={COLORS.handle} flatShading roughness={0.8} />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.18, 0]} castShadow>
        <boxGeometry args={[0.04, 0.1, 0.04]} />
        <meshStandardMaterial color={COLORS.handleDark} flatShading roughness={0.7} />
      </mesh>

      {/* Handle T-grip */}
      <mesh position={[0, -0.25, 0]} castShadow>
        <boxGeometry args={[0.1, 0.035, 0.035]} />
        <meshStandardMaterial color={COLORS.handleDark} flatShading roughness={0.7} />
      </mesh>

      {/* Neck connecting to blade */}
      <mesh position={[0, 0.22, 0]} castShadow>
        <boxGeometry args={[0.04, 0.06, 0.04]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Shovel blade */}
      <mesh position={[0, 0.32, 0]} castShadow>
        <boxGeometry args={[0.12, 0.15, 0.025]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Blade edge */}
      <mesh position={[0, 0.41, 0]} castShadow>
        <boxGeometry args={[0.11, 0.03, 0.02]} />
        <meshStandardMaterial color={COLORS.metalEdge} flatShading metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  );
}

export default Shovel;
