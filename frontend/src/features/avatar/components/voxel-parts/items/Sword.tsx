/**
 * Sword Item Component
 * Medieval sword with silver blade and brown handle
 */

import * as THREE from 'three';

interface SwordProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number;
}

const COLORS = {
  blade: '#C0C0C0',      // Silver blade
  handle: '#8B4513',     // Brown handle
  guard: '#FFD700',      // Gold guard
  pommel: '#FFD700',     // Gold pommel
};

export function Sword({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 1,
}: SwordProps) {
  return (
    <group
      position={position}
      rotation={rotation.map(r => r * Math.PI / 180) as [number, number, number]}
      scale={[scale, scale, scale]}
    >
      {/* Blade */}
      <mesh position={[0, 0.3, 0]} castShadow>
        <boxGeometry args={[0.06, 0.5, 0.03]} />
        <meshStandardMaterial
          color={COLORS.blade}
          flatShading
          metalness={0.6}
          roughness={0.3}
        />
      </mesh>

      {/* Blade tip */}
      <mesh position={[0, 0.58, 0]} castShadow>
        <boxGeometry args={[0.04, 0.08, 0.02]} />
        <meshStandardMaterial
          color={COLORS.blade}
          flatShading
          metalness={0.6}
          roughness={0.3}
        />
      </mesh>

      {/* Guard (crossguard) */}
      <mesh position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[0.15, 0.04, 0.04]} />
        <meshStandardMaterial
          color={COLORS.guard}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>

      {/* Handle */}
      <mesh position={[0, -0.1, 0]} castShadow>
        <boxGeometry args={[0.05, 0.18, 0.05]} />
        <meshStandardMaterial
          color={COLORS.handle}
          flatShading
          roughness={0.8}
        />
      </mesh>

      {/* Pommel */}
      <mesh position={[0, -0.22, 0]} castShadow>
        <boxGeometry args={[0.07, 0.05, 0.07]} />
        <meshStandardMaterial
          color={COLORS.pommel}
          flatShading
          metalness={0.5}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}

export default Sword;
