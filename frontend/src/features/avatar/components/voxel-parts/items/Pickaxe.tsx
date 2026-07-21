/**
 * Pickaxe Item Component
 * Mining tool with double-pointed head
 */

interface PickaxeProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  metal: '#607D8B',
  metalDark: '#455A64',
  handle: '#8B4513',
  handleDark: '#654321',
};

export function Pickaxe({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: PickaxeProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Handle */}
      <mesh position={[0, -0.05, 0]} castShadow>
        <boxGeometry args={[0.04, 0.35, 0.04]} />
        <meshStandardMaterial color={COLORS.handle} flatShading roughness={0.8} />
      </mesh>

      {/* Handle grip */}
      <mesh position={[0, -0.2, 0]} castShadow>
        <boxGeometry args={[0.045, 0.1, 0.045]} />
        <meshStandardMaterial color={COLORS.handleDark} flatShading roughness={0.7} />
      </mesh>

      {/* Head center */}
      <mesh position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.08, 0.06, 0.05]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Pick point - right */}
      <mesh position={[0.08, 0.15, 0]} castShadow>
        <boxGeometry args={[0.12, 0.04, 0.035]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.16, 0.15, 0]} castShadow>
        <boxGeometry args={[0.05, 0.025, 0.025]} />
        <meshStandardMaterial color={COLORS.metalDark} flatShading metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Pick point - left */}
      <mesh position={[-0.08, 0.15, 0]} castShadow>
        <boxGeometry args={[0.12, 0.04, 0.035]} />
        <meshStandardMaterial color={COLORS.metal} flatShading metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-0.16, 0.15, 0]} castShadow>
        <boxGeometry args={[0.05, 0.025, 0.025]} />
        <meshStandardMaterial color={COLORS.metalDark} flatShading metalness={0.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

export default Pickaxe;
