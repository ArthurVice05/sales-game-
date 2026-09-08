import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { createResultsScale, resultsProgress, RESULTS_GROWTH_MS, RESULTS_REACTION_MS } from './resultsPresentation.js'

const METALS = [0xe9bd63, 0xb8cadc, 0xc98b6d]

/** Real, articulated meshes. All geometry/material resources belong to this scene. */
export function createResultsScene(entries) {
  const scene = new THREE.Scene()
  const scale = createResultsScale(entries.map(entry => entry.player.patrimonio))
  const camera = new THREE.OrthographicCamera(-5, 5, 6, -1, .1, 80)
  const resources = new Set()
  const own = resource => { resources.add(resource); return resource }
  const sphere = own(new THREE.SphereGeometry(1, 16, 12))
  const limb = own(new THREE.CapsuleGeometry(.043, .16, 4, 8))
  const body = own(new RoundedBoxGeometry(.23, .26, .15, 3, .04))
  const columnGeometry = own(new RoundedBoxGeometry(1.12, 1, .66, 4, .035))
  const skin = own(new THREE.MeshStandardMaterial({ color: 0xeac3a0, roughness: .65 }))
  const dark = own(new THREE.MeshStandardMaterial({ color: 0x172638, roughness: .6 }))
  const eye = own(new THREE.MeshStandardMaterial({ color: 0x15202d, roughness: .5 }))
  const tearMaterial = own(new THREE.MeshStandardMaterial({ color: 0x93d9ee, roughness: .22, metalness: .15 }))

  const mesh = (geometry, material, parent, x = 0, y = 0, z = 0) => {
    const object = new THREE.Mesh(geometry, material)
    object.position.set(x, y, z)
    parent.add(object)
    return object
  }
  const ball = (parent, material, x, y, z, sx, sy = sx, sz = sx) => {
    const object = mesh(sphere, material, parent, x, y, z)
    object.scale.set(sx, sy, sz)
    return object
  }
  function character(shirt, place) {
    const group = new THREE.Group(), head = new THREE.Group()
    head.position.y = .67; group.add(head)
    ball(head, skin, 0, 0, 0, .145, .16, .135)
    ball(head, dark, 0, .09, -.03, .15, .085, .13)
    for (const x of [-.049, .049]) ball(head, eye, x, .018, .124, .013)
    const mouthGeometry = own(new THREE.TorusGeometry(.039, .008, 5, 12, Math.PI))
    const mouth = mesh(mouthGeometry, eye, head, 0, -.035, .129)
    mouth.rotation.z = place === 3 ? 0 : Math.PI
    if (place === 2) mouth.scale.setScalar(.7)
    const tear = ball(head, tearMaterial, .079, -.044, .126, .012, .023, .01)
    tear.visible = false
    mesh(body, shirt, group, 0, .4, 0)
    const arms = [-1, 1].map(side => {
      const pivot = new THREE.Group()
      pivot.position.set(side * .15, .5, 0); group.add(pivot)
      mesh(limb, shirt, pivot, 0, -.1, 0)
      const elbow = new THREE.Group(); elbow.position.y = -.19; pivot.add(elbow)
      const forearm = mesh(limb, skin, elbow, 0, -.065, 0)
      forearm.scale.y = .55
      ball(elbow, skin, 0, -.135, 0, .047)
      return { pivot, elbow }
    })
    const legs = [-1, 1].map(side => {
      const pivot = new THREE.Group(); pivot.position.set(side * .067, .27, 0); group.add(pivot)
      mesh(limb, dark, pivot, 0, -.12, 0)
      ball(pivot, dark, 0, -.235, .025, .06, .035, .087)
      return pivot
    })
    return { group, head, tear, legs, leftArm: arms[0].pivot, rightArm: arms[1].pivot, leftElbow: arms[0].elbow, rightElbow: arms[1].elbow }
  }

  const columns = entries.map(entry => {
    const material = own(new THREE.MeshStandardMaterial({ color: METALS[entry.place - 1], metalness: .65, roughness: .32 }))
    const shirt = own(new THREE.MeshStandardMaterial({ color: entry.place === 1 ? 0x27876c : entry.place === 2 ? 0x45779a : 0x976366, roughness: .5 }))
    const column = mesh(columnGeometry, material, scene)
    column.rotation.y = -.22
    const person = character(shirt, entry.place); scene.add(person.group)
    return { column, person, entry }
  })
  const baselineGeometry = own(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 0, .4), new THREE.Vector3(1, 0, .4)]))
  const baseline = new THREE.Line(baselineGeometry, own(new THREE.LineBasicMaterial({ color: 0x92a9b6, transparent: true, opacity: .6 })))
  scene.add(baseline, new THREE.HemisphereLight(0xe4f0ff, 0x1b2634, 2))
  const key = new THREE.DirectionalLight(0xffe4b7, 3.1); key.position.set(-4, 7, 6)
  const fill = new THREE.DirectionalLight(0xa1c9ee, 1.8); fill.position.set(4, 3, 2)
  scene.add(key, fill)

  let disposed = false
  function update(elapsed) {
    if (disposed) return
    const progress = resultsProgress(elapsed)
    const reaction = Math.max(0, Math.min(1, (elapsed - RESULTS_GROWTH_MS) / RESULTS_REACTION_MS))
    for (const { column, person, entry } of columns) {
      const height = scale.height(entry.player.patrimonio) * progress
      column.visible = height !== 0
      column.scale.y = Math.abs(height)
      column.position.y = height / 2
      // Non-positive columns extend below zero; the baseline supports their figures.
      person.group.position.y = Math.max(0, height)
      person.leftArm.rotation.z = -.14
      person.rightArm.rotation.z = .14
      person.leftElbow.rotation.x = 0
      person.rightElbow.rotation.x = 0
      person.head.rotation.x = 0
      person.tear.visible = false
      if (entry.place === 1) {
        const raise = Math.min(1, reaction * 4)
        person.leftArm.rotation.z = -.14 - 2.45 * raise
        person.rightArm.rotation.z = .14 + 2.45 * raise
        const jump = reaction > 0 && reaction < 1 ? .23 * Math.sin(reaction * Math.PI * 2) ** 2 : 0
        person.group.position.y += jump
        person.legs.forEach((leg, index) => { leg.rotation.z = (index ? 1 : -1) * jump * .4 })
      } else if (entry.place === 2) {
        person.rightArm.rotation.z = .14 + Math.min(1, reaction * 5) * 1.6 + Math.sin(reaction * Math.PI * 4) * .18
        person.rightElbow.rotation.x = -.3 * reaction
      } else {
        person.head.rotation.x = .2 * Math.min(1, reaction * 4)
        person.leftArm.rotation.z = -.07
        person.rightArm.rotation.z = .14 + Math.sin(reaction * Math.PI) * 2.55
        person.rightElbow.rotation.x = -Math.sin(reaction * Math.PI) * .8
        person.tear.visible = reaction > .15 && reaction < .9
      }
    }
  }

  function resize(width, height) {
    // Orthographic, no horizontal yaw: every column shares the same projected baseline
    // and vertical scale. Slight elevation reveals depth without a perspective podium.
    const bottom = scale.min - .3, top = Math.max(scale.max, 0) + 1.45
    const worldHeight = Math.max(5.75, top - bottom)
    const worldWidth = Math.max(entries.length * 1.65, worldHeight * width / Math.max(1, height))
    const viewHeight = worldWidth * height / Math.max(1, width)
    const center = (top + bottom) / 2
    camera.left = -worldWidth / 2; camera.right = worldWidth / 2
    camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2
    camera.position.set(0, center + 2, 20); camera.lookAt(0, center, 0); camera.updateProjectionMatrix()
    columns.forEach(({ column, person }, index) => {
      const x = worldWidth * ((index + .5) / columns.length - .5)
      column.position.x = x; person.group.position.x = x
    })
    baseline.scale.x = worldWidth * .48
  }
  return {
    scene, camera, scale, columns, update, resize,
    dispose() {
      if (disposed) return
      disposed = true
      resources.forEach(resource => resource.dispose())
      resources.clear(); scene.clear()
    },
  }
}
