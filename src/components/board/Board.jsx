import React from 'react'

import {
  BOARD_VERSION_CURRENT,
  resolveBoardVersion,
} from '../../data/boardVersions.js'
import LegacyBoard from '../Board.jsx'
import LandscapeBoard from './LandscapeBoard.jsx'

/** Mantém o Board legado somente para snapshots v1-55. */
export default function Board(props) {
  const version = resolveBoardVersion(props.boardVersion)
  if (version === BOARD_VERSION_CURRENT) {
    return <LandscapeBoard {...props} />
  }
  return <LegacyBoard {...props} />
}
