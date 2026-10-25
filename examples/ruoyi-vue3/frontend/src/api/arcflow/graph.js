import request from '@/utils/request'
import { parseScenarioJson } from '../../views/arcflow/graph/shared/scenarios/scenario-json.js'
import { createNativeGraphTransport } from './graph-transport.js'
export const nativeGraphTransport = getToken => createNativeGraphTransport({ request, getToken, parseJson: parseScenarioJson })
