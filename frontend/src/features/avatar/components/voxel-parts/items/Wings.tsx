/**
 * Wings Item Component
 * Angelic white wings
 */

interface WingsProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  feather: '#FFFFFF',
  featherLight: '#F5F5F5',
  featherTip: '#E5E5E5',
};

export function Wings({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: WingsProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* === Left Wing === */}
      <group position={[-0.15, 0.15, 0]} rotation={[0, -0.3, 0.2]}>
        {/* Wing base */}
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.2, 0.25, 0.03]} />
          <meshStandardMaterial color={COLORS.feather} flatShading roughness={0.9} />
        </mesh>

        {/* Wing middle section */}
        <mesh position={[-0.15, 0.02, 0]} castShadow>
          <boxGeometry args={[0.15, 0.2, 0.025]} />
          <meshStandardMaterial color={COLORS.featherLight} flatShading roughness={0.9} />
        </mesh>

        {/* Wing tip feathers */}
        <mesh position={[-0.25, 0.0, 0]} castShadow>
          <boxGeometry args={[0.1, 0.15, 0.02]} />
          <meshStandardMaterial color={COLORS.featherTip} flatShading roughness={0.9} />
        </mesh>

        {/* Top feathers */}
        <mesh position={[-0.08, 0.15, 0]} castShadow>
          <boxGeometry args={[0.12, 0.08, 0.02]} />
          <meshStandardMaterial color={COLORS.feather} flatShading roughness={0.9} />
        </mesh>
      </group>

      {/* === Right Wing === */}
      <group position={[0.15, 0.15, 0]} rotation={[0, 0.3, -0.2]}>
        {/* Wing base */}
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[0.2, 0.25, 0.03]} />
          <meshStandardMaterial color={COLORS.feather} flatShading roughness={0.9} />
        </mesh>

        {/* Wing middle section */}
        <mesh position={[0.15, 0.02, 0]} castShadow>
          <boxGeometry args={[0.15, 0.2, 0.025]} />
          <meshStandardMaterial color={COLORS.featherLight} flatShading roughness={0.9} />
        </mesh>

        {/* Wing tip feathers */}
        <mesh position={[0.25, 0.0, 0]} castShadow>
          <boxGeometry args={[0.1, 0.15, 0.02]} />
          <meshStandardMaterial color={COLORS.featherTip} flatShading roughness={0.9} />
        </mesh>

        {/* Top feathers */}
        <mesh position={[0.08, 0.15, 0]} castShadow>
          <boxGeometry args={[0.12, 0.08, 0.02]} />
          <meshStandardMaterial color={COLORS.feather} flatShading roughness={0.9} />
        </mesh>
      </group>

      {/* Center connection */}
      <mesh position={[0, 0.1, 0]} castShadow>
        <boxGeometry args={[0.08, 0.1, 0.03]} />
        <meshStandardMaterial color={COLORS.featherLight} flatShading roughness={0.9} />
      </mesh>
    </group>
  );
}

export default Wings;
