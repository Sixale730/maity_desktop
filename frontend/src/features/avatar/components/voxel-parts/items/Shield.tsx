/**
 * Shield Item Component
 * Classic kite shield with emblem
 */

interface ShieldProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  body: '#DC2626',       // Red shield body
  rim: '#FFD700',        // Gold rim
  emblem: '#FFD700',     // Gold emblem
  back: '#8B4513',       // Brown back (wood)
};

export function Shield({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: ShieldProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Main shield body */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[0.08, 0.4, 0.3]} />
        <meshStandardMaterial
          color={COLORS.body}
          flatShading
          roughness={0.6}
        />
      </mesh>

      {/* Shield bottom point */}
      <mesh position={[0, -0.22, 0]} castShadow>
        <boxGeometry args={[0.06, 0.08, 0.18]} />
        <meshStandardMaterial
          color={COLORS.body}
          flatShading
          roughness={0.6}
        />
      </mesh>

      {/* Gold rim - top */}
      <mesh position={[0.045, 0.18, 0]} castShadow>
        <boxGeometry args={[0.02, 0.08, 0.32]} />
        <meshStandardMaterial
          color={COLORS.rim}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>

      {/* Gold emblem - cross */}
      <mesh position={[0.045, 0, 0]} castShadow>
        <boxGeometry args={[0.02, 0.2, 0.04]} />
        <meshStandardMaterial
          color={COLORS.emblem}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>
      <mesh position={[0.045, 0.02, 0]} castShadow>
        <boxGeometry args={[0.02, 0.04, 0.15]} />
        <meshStandardMaterial
          color={COLORS.emblem}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>

      {/* Back of shield (wooden) */}
      <mesh position={[-0.04, 0, 0]} castShadow>
        <boxGeometry args={[0.02, 0.35, 0.25]} />
        <meshStandardMaterial
          color={COLORS.back}
          flatShading
          roughness={0.9}
        />
      </mesh>
    </group>
  );
}

export default Shield;
