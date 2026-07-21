/**
 * Hammer Item Component
 * Work hammer with wooden handle and metal head
 */

interface HammerProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  head: '#607D8B',       // Steel gray head
  handle: '#8B4513',     // Brown wooden handle
  grip: '#654321',       // Darker grip
};

export function Hammer({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: HammerProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Hammer head - main striking surface */}
      <mesh position={[0, 0.28, 0]} castShadow>
        <boxGeometry args={[0.18, 0.1, 0.08]} />
        <meshStandardMaterial
          color={COLORS.head}
          flatShading
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>

      {/* Hammer head - claw end */}
      <mesh position={[-0.08, 0.28, 0]} castShadow>
        <boxGeometry args={[0.06, 0.08, 0.06]} />
        <meshStandardMaterial
          color={COLORS.head}
          flatShading
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>

      {/* Handle */}
      <mesh position={[0, 0.05, 0]} castShadow>
        <boxGeometry args={[0.05, 0.35, 0.05]} />
        <meshStandardMaterial
          color={COLORS.handle}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Handle grip area */}
      <mesh position={[0, -0.1, 0]} castShadow>
        <boxGeometry args={[0.055, 0.12, 0.055]} />
        <meshStandardMaterial
          color={COLORS.grip}
          flatShading
          roughness={0.7}
        />
      </mesh>
    </group>
  );
}

export default Hammer;
