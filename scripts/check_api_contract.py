#!/usr/bin/env python3
"""Check the reviewed OpenAPI contracts against ArcFlow source, offline.

Standard library only. This is a fail-closed validator for the JSON Schema
keywords used by this repository, not a general OpenAPI/JSON Schema validator.
Source fingerprints force review when domain behavior exceeds structural checks.
Run real HTTP examples as well; static checks do not replace Spring/domain tests.
"""
import argparse
import datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SPEC_DIR = Path('docs/api/openapi')
DOMAIN = 'examples/approval-domain/src/main/java/com/arcflow/approval/'
DEMO = 'examples/approval-demo/backend/src/main/java/com/arcflow/demo/'
RUOYI = 'examples/ruoyi-vue3/backend/src/main/java/com/ruoyi/arcflow/'
SOURCE_GUARDS = ({DOMAIN + n + '.java' for n in ('ApprovalService', 'BusinessDocument', 'ConditionalRouting', 'ProcessDefinition', 'ScenarioCatalog', 'ScenarioCase', 'QuoteDiscountCase', 'InboxQuery', 'StrictBusinessTypeResolver')}
                 | {DEMO + n + '.java' for n in ('ApprovalController', 'ScenarioController', 'QuoteDiscountController', 'SecurityConfig', 'JsonConfig', 'ScenarioConfiguration')}
                 | {RUOYI + n + '.java' for n in ('ArcFlowController', 'ArcFlowErrors', 'ArcFlowConfiguration')})
METHODS = {'get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'}
KEYWORDS = {'$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties',
            'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems',
            'minLength', 'maxLength', 'pattern', 'format', 'enum', 'const', 'minimum', 'maximum',
            'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'oneOf', 'anyOf', 'allOf',
            'if', 'then', 'else', 'not', 'default', 'examples', 'readOnly', 'deprecated'}


class ContractError(ValueError):
    pass


class JsonInteger(int):
    def __new__(cls, token):
        result = int.__new__(cls, token)
        result.token = token
        return result


def require(condition, message):
    if not condition:
        raise ContractError(message)


def fixed_scenario_nonblank(value):
    blank = set(range(0x21)) | {0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff} | set(range(0x2000, 0x200b))
    return any(ord(c) not in blank for c in value)


def java_trim(value):
    return value.strip(''.join(chr(c) for c in range(0x21)))


def java_nonblank(value):
    blank = set(range(9, 14)) | set(range(0x1c, 0x21)) | {0x1680, 0x2028, 0x2029, 0x205f, 0x3000} | set(range(0x2000, 0x2007)) | set(range(0x2008, 0x200b))
    return any(ord(c) not in blank for c in value)


def load_json(path, lexical=False):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, f'{path}: duplicate JSON key {key}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs,
                      parse_float=Decimal if lexical else float,
                      parse_int=JsonInteger if lexical else int,
                      parse_constant=lambda value: (_ for _ in ()).throw(ContractError(f'{path}: invalid number {value}')))


def java_code(text):
    """Drop comments without treating comment delimiters inside literals as comments."""
    return re.sub(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//[^\n]*|/\*.*?\*/',
                  lambda m: ' ' if m[0].startswith(('//', '/*')) else m[0], text, flags=re.S)


def source_digest(path):
    # Token separators/indentation and comments cannot change this digest; literals can.
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|[A-Za-z_$][\w$]*|\d+|[^\s]', java_code(path.read_text()))
    return hashlib.sha256('\0'.join(tokens).encode()).hexdigest()


def balanced(text, start, opening='(', closing=')'):
    require(text[start] == opening, f'Expected {opening} in Java source')
    depth, quote, escaped = 0, None, False
    for i in range(start, len(text)):
        c = text[i]
        if quote:
            if escaped: escaped = False
            elif c == '\\': escaped = True
            elif c == quote: quote = None
        elif c in "\"'": quote = c
        elif c == opening: depth += 1
        elif c == closing:
            depth -= 1
            if not depth: return text[start + 1:i], i + 1
    raise ContractError('Unbalanced Java source')


def strip_annotations(text):
    while True:
        match = re.search(r'@[\w.]+', text)
        if not match: return text
        end = match.end()
        while end < len(text) and text[end].isspace(): end += 1
        if end < len(text) and text[end] == '(':
            _, end = balanced(text, end)
        text = text[:match.start()] + ' ' + text[end:]


def record_fields(source, name):
    match = re.search(r'\brecord\s+' + re.escape(name) + r'\s*\(', java_code(source))
    require(match, f'Java record missing: {name}')
    fields, _ = balanced(java_code(source), match.end() - 1)
    fields = strip_annotations(fields)
    # Records here have lists/sets but no comma-bearing nested type arguments.
    fields = re.sub(r'<[^<>]*>', '', fields)
    result = []
    for field in fields.split(','):
        match = re.fullmatch(r'\s*([\w.]+)(?:\[\])?\s+(\w+)\s*', field)
        require(match, f'Unsupported Java record declaration {name}: {field!r}; review parser')
        result.append(match.group(2))
    return result


def controller_routes(root):
    routes = {}
    files = []
    for source in sorted((root / 'examples').glob('**/src/main/java/**/*.java')):
        if '/target/' in str(source) or '/.work/' in str(source): continue
        code = java_code(source.read_text())
        if not re.search(r'@RestController\b', code): continue
        files.append(source)
        bases = re.findall(r'@RequestMapping\s*\(\s*"([^"]+)"\s*\)', code)
        require(len(bases) == 1, f'{source}: unsupported/multiple class RequestMapping; review contract parser')
        for match in re.finditer(r'@(Get|Post|Put|Patch|Delete|Head|Options)Mapping\b', code):
            end = match.end(); args = ''
            while end < len(code) and code[end].isspace(): end += 1
            if code[end] == '(': args, end = balanced(code, end)
            values = re.findall(r'"([^"]*)"', args)
            require(len(values) <= 1, f'{source}: multiple mapping literals need a reviewed parser')
            path = bases[0] + (values[0] if values else '')
            # The method body brace occurs after annotations and method parameters.
            tail = code[end:]
            cleaned = strip_annotations(tail[:tail.index('{')])
            signature = re.search(r'(?:public\s+)?([\w.<>?, ]+?)\s+(\w+)\s*\(', cleaned)
            require(signature, f'{source}: cannot identify mapping handler for {path}')
            method = match[1].upper(); key = (method, path)
            require(key not in routes, f'Duplicate controller route {key}')
            annotations = tail[:tail.index('{')]
            permission = re.search(r"hasPermi\('([^']+)'\)", annotations)
            created = bool(re.search(r'@ResponseStatus\(HttpStatus.CREATED\)', annotations))
            routes[key] = {'source': str(source.relative_to(root)), 'handler': signature[2],
                           'return': re.sub(r'\s+', '', re.sub(r'^\s*public\s+', '', signature[1])),
                           'success': '201' if created else '200',
                           'permission': permission[1] if permission else None,
                           'consumes': 'application/json' if 'MediaType.APPLICATION_JSON_VALUE' in args else None,
                           'host': 'ruoyi' if bases[0] == '/arcflow' else 'standalone'}
    require(len(files) == 4, f'Controller class inventory changed: found {len(files)}, expected 4')
    require(len(routes) == 30, f'Controller route inventory changed: found {len(routes)}, expected 30')
    return routes


class Checker:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.documents = {}
        self.examples = set()

    def document(self, path):
        path = Path(path).resolve()
        require(path.is_relative_to(self.root), f'Reference escapes repository: {path}')
        require(path.is_file(), f'Missing reference document: {path}')
        if path not in self.documents: self.documents[path] = load_json(path)
        return self.documents[path]

    def resolve(self, reference, base):
        require('://' not in reference and not reference.startswith('/'), f'Only repository-local refs are supported: {reference}')
        file, _, pointer = reference.partition('#')
        path = (Path(base).parent / file).resolve() if file else Path(base).resolve()
        value = self.document(path)
        require(not pointer or pointer.startswith('/'), f'Only JSON Pointer refs are supported: {reference}')
        for token in pointer.split('/')[1:]:
            token = token.replace('~1', '/').replace('~0', '~')
            require(isinstance(value, dict) and token in value, f'Unresolved $ref {reference} in {base}')
            value = value[token]
        return value, path

    def refs(self, node, base):
        if isinstance(node, dict):
            if '$ref' in node: self.resolve(node['$ref'], base)
            for value in node.values(): self.refs(value, base)
        elif isinstance(node, list):
            for value in node: self.refs(value, base)

    def lint_schema(self, schema, base):
        require(isinstance(schema, (dict, bool)), 'Schema must be an object or boolean')
        if isinstance(schema, bool): return
        unknown = {k for k in schema if k not in KEYWORDS and not k.startswith('x-')}
        require(not unknown, f'Unsupported schema keywords {unknown}; extend checker before using them')
        if '$ref' in schema: self.resolve(schema['$ref'], base)
        if 'x-nonblank' in schema:
            require(schema['x-nonblank'] in {'java-isBlank', 'java-trim-isBlank', 'unicode-space-c0-bom'}, 'Unsupported x-nonblank policy; extend checker before using it')
        if 'type' in schema:
            kinds = schema['type'] if isinstance(schema['type'], list) else [schema['type']]
            require(set(kinds) <= {'null', 'boolean', 'object', 'array', 'number', 'integer', 'string'}, 'Invalid schema type')
        if 'required' in schema:
            require(isinstance(schema['required'], list) and len(schema['required']) == len(set(schema['required'])), 'Invalid required list')
            require(set(schema['required']) <= set(schema.get('properties', {})), 'Required field has no property schema')
        for key in ['properties', '$defs']:
            for child in schema.get(key, {}).values(): self.lint_schema(child, base)
        for key in ['items', 'additionalProperties', 'if', 'then', 'else', 'not']:
            if key in schema: self.lint_schema(schema[key], base)
        for key in ['oneOf', 'anyOf', 'allOf']:
            if key in schema:
                require(isinstance(schema[key], list) and schema[key], f'{key} must not be empty')
                for child in schema[key]: self.lint_schema(child, base)

    def validate(self, value, schema, base, where='$'):
        if isinstance(schema, bool):
            require(schema, f'{where}: false schema'); return
        if '$ref' in schema:
            target, target_path = self.resolve(schema['$ref'], base)
            self.validate(value, target, target_path, where)
        def matches(candidate):
            try: self.validate(value, candidate, base, where); return True
            except ContractError: return False
        if 'oneOf' in schema: require(sum(matches(s) for s in schema['oneOf']) == 1, f'{where}: must match exactly one schema alternative')
        if 'anyOf' in schema: require(any(matches(s) for s in schema['anyOf']), f'{where}: no schema alternative matched')
        for child in schema.get('allOf', []): self.validate(value, child, base, where)
        if 'if' in schema:
            branch = 'then' if matches(schema['if']) else 'else'
            if branch in schema: self.validate(value, schema[branch], base, where)
        if 'not' in schema: require(not matches(schema['not']), f'{where}: forbidden schema matched')
        if 'const' in schema: require(value == schema['const'] and not (isinstance(value, bool) ^ isinstance(schema['const'], bool)), f'{where}: incorrect constant')
        if 'enum' in schema: require(value in schema['enum'] and not isinstance(value, bool), f'{where}: value outside enum')
        kinds = schema.get('type', []); kinds = [kinds] if isinstance(kinds, str) else kinds
        types = {'null': value is None, 'boolean': isinstance(value, bool), 'string': isinstance(value, str),
                 'object': isinstance(value, dict), 'array': isinstance(value, list),
                 'integer': isinstance(value, (int, Decimal)) and not isinstance(value, bool) and value == int(value),
                 'number': isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)}
        require(not kinds or any(types[k] for k in kinds), f'{where}: expected {kinds}')
        if isinstance(value, dict):
            props = schema.get('properties', {})
            require(set(schema.get('required', [])) <= value.keys(), f'{where}: missing required fields {set(schema.get("required", [])) - value.keys()}')
            for k, v in value.items():
                if k in props: self.validate(v, props[k], base, where + '.' + k)
                elif 'additionalProperties' in schema: self.validate(v, schema['additionalProperties'], base, where + '.' + k)
        if isinstance(value, list):
            require(len(value) >= schema.get('minItems', 0) and len(value) <= schema.get('maxItems', sys.maxsize), f'{where}: array bounds')
            if schema.get('uniqueItems'): require(all(value[i] not in value[:i] for i in range(len(value))), f'{where}: duplicate array item')
            if 'items' in schema:
                for i, item in enumerate(value): self.validate(item, schema['items'], base, f'{where}[{i}]')
        if isinstance(value, str):
            require(len(value) >= schema.get('minLength', 0) and len(value) <= schema.get('maxLength', sys.maxsize), f'{where}: string length')
            if 'pattern' in schema: require((re.fullmatch(schema['pattern'], value) if schema['pattern'].startswith('^') and schema['pattern'].endswith('$') else re.search(schema['pattern'], value)), f'{where}: pattern mismatch')
            if schema.get('x-nonblank'):
                policy = schema['x-nonblank']
                require(policy in {'java-isBlank', 'java-trim-isBlank', 'unicode-space-c0-bom'}, f'{where}: unsupported x-nonblank policy')
                nonblank = (fixed_scenario_nonblank(value) if policy == 'unicode-space-c0-bom' else
                            java_nonblank(java_trim(value)) if policy == 'java-trim-isBlank' else java_nonblank(value))
                require(nonblank, f'{where}: blank text under {policy}')
            if schema.get('x-no-iso-controls'): require(not any(ord(c) < 0x20 or 0x7f <= ord(c) <= 0x9f for c in value), f'{where}: ISO control character')
            if 'x-min-year' in schema: require(int(value[:4]) >= schema['x-min-year'], f'{where}: date year')
            if 'x-java-utf16-max' in schema: require(sum(2 if ord(character) > 0xffff else 1 for character in value) <= schema['x-java-utf16-max'], f'{where}: UTF-16 length')
            if schema.get('format') == 'date':
                try: datetime.date.fromisoformat(('2000' + value[4:]) if value.startswith('0000-') else value)
                except ValueError: raise ContractError(f'{where}: invalid calendar date')
            if schema.get('format') == 'date-time':
                try: datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
                except ValueError: raise ContractError(f'{where}: invalid timestamp')
        if types['number']:
            n = Decimal(str(value))
            for key, good in [('minimum', lambda b: n >= b), ('maximum', lambda b: n <= b), ('exclusiveMinimum', lambda b: n > b), ('exclusiveMaximum', lambda b: n < b)]:
                if key in schema: require(good(Decimal(str(schema[key]))), f'{where}: {key}')
            if 'multipleOf' in schema: require(n % Decimal(str(schema['multipleOf'])) == 0, f'{where}: decimal precision')
            if schema.get('x-json-integer'): require(isinstance(value, int), f'{where}: requires a JSON integer token')
            if schema.get('x-forbid-negative-zero'): require(getattr(value, 'token', None) != '-0', f'{where}: negative zero forbidden')
            if 'x-max-scale' in schema: require(-n.as_tuple().exponent <= schema['x-max-scale'], f'{where}: excess lexical decimal scale')

    def source_models(self, schemas):
        business_source = (self.root / DOMAIN / 'BusinessDocument.java').read_text()
        registered = re.findall(r'@JsonSubTypes.Type\(value\s*=\s*BusinessDocument\.(\w+)\.class,\s*name\s*=\s*"([^"]+)"', business_source)
        require(len(registered) == 9, 'Business type count changed; review all hosts and schemas')
        require(set(schemas['DocumentType']['enum']) == {wire for _, wire in registered}, 'Document type enum differs from Java subtype registry')
        require({r['$ref'].split('/')[-1] for r in schemas['BusinessDocument']['oneOf']} == {name for name, _ in registered}, 'BusinessDocument union differs from Java registry')
        require(schemas['GenericBusinessDocument']['oneOf'] == [{'$ref': '#/$defs/Leave'}, {'$ref': '#/$defs/Procurement'}], 'Generic document union must remain leave/procurement')
        require({r['$ref'].split('/')[-1] for r in schemas['ScenarioBusinessDocument']['oneOf']} == {name for name, _ in registered} - {'Leave', 'Procurement', 'QuoteDiscount'}, 'Scenario document union drift')
        require({r['$ref'].split('/')[-1] for r in schemas['RoutingPredicate']['oneOf']} == {'PaymentPredicate', 'ReceivingPredicate', 'ContractPredicate'}, 'Routing predicate union drift')
        for name, wire in registered:
            require(schemas[name]['properties']['type'] == {'const': wire}, f'{name}: discriminator drift')
        for name, schema in schemas.items():
            source = schema.get('x-java-record')
            if not source: continue
            fields = record_fields((self.root / source['source']).read_text(), source['name'])
            require(set(schema['properties']) == set(fields) | set(source['synthetic']), f'{name}: Java record/property parity drift')
            require(set(schema['required']) == set(schema['properties']) - set(source['optional']), f'{name}: required/omitted field drift')
        for model, field in [('ExpenseLine', 'description'), ('Travel', 'title'), ('Travel', 'reason'), ('Travel', 'destination')]:
            require(schemas[model]['properties'][field].get('x-nonblank') == 'java-trim-isBlank', f'{model}.{field}: Java trim/isBlank contract drift')
        require('revision' not in schemas['Request']['properties'] and 'revision' not in schemas['QuoteView']['properties'], 'Invented revision response field')
        require(schemas['Error'] == {'type': 'object', 'properties': {'message': {'type': 'string'}}, 'required': ['message'], 'additionalProperties': False}, 'Standalone controlled error envelope changed')

    def check(self):
        routes = controller_routes(self.root)
        inventory = load_json(self.root / 'docs/api/endpoint-inventory.json')['endpoints']
        require(len(inventory) == len(routes) and {(r['method'], r['path']) for r in inventory} == set(routes), 'Endpoint inventory/controller route drift')
        for item in inventory:
            route = routes[item['method'], item['path']]
            require(item['source'] == route['source'] and item['host'] == route['host'], 'Endpoint inventory source/host drift')
            require(item.get('consumes') == route['consumes'], 'Endpoint inventory consumes drift')
        schema_path = self.root / SPEC_DIR / 'schemas.json'
        shared = self.document(schema_path); self.lint_schema(shared, schema_path); self.refs(shared, schema_path)
        schemas = shared['$defs']; self.source_models(schemas)
        catalog_text = java_code((self.root / DOMAIN / 'ScenarioCatalog.java').read_text())
        catalog = dict(re.findall(r'new Template\("([^"]+)",\s*"(?:OA|ERP|CRM)",\s*"([^"]+)"', catalog_text))
        require(len(catalog) == 6, 'Scenario catalog count changed')
        registry = (self.root / DEMO / 'ScenarioConfiguration.java').read_text()
        require(set(re.findall(r'"((?:oa|erp|crm)-[a-z-]+)"\s*,\s*\w+Scenario', registry)) == set(catalog), 'Registered scenario handlers differ from catalog')
        require(set(schemas['ScenarioId']['enum']) == set(catalog), 'ScenarioId schema drift')
        condition_text = java_code((self.root / DOMAIN / 'ConditionalRouting.java').read_text())
        families = set(re.findall(r'case "([^"]+)" -> BusinessDocument\.', condition_text))
        require(len(families) == 3, 'Conditional routing family count changed')
        require({schemas[n]['properties']['field']['const'] for n in ('PaymentPredicate', 'ReceivingPredicate', 'ContractPredicate')} == families, 'runIf predicate schema drift')
        operations = {}; ids = set()
        for host in ('standalone', 'ruoyi'):
            path = self.root / SPEC_DIR / (host + '.openapi.json'); spec = self.document(path)
            require(spec['openapi'] == '3.1.0', 'Unsupported OpenAPI version')
            require(spec.get('info', {}).get('title') and spec['info'].get('version'), 'OpenAPI info requires title/version')
            self.refs(spec, path)
            require(spec.get('security') == [{'basicAuth' if host == 'standalone' else 'ruoyiBearer': []}], f'{host}: authentication contract drift')
            scheme = spec['components']['securitySchemes']['basicAuth' if host == 'standalone' else 'ruoyiBearer']
            require(scheme['type'] == 'http' and scheme['scheme'] == ('basic' if host == 'standalone' else 'bearer'), f'{host}: security scheme drift')
            if host == 'standalone':
                require(spec['x-scenario-catalog'] == catalog, 'OpenAPI scenario catalog drift')
                require(set(spec['x-condition-families']) == families, 'OpenAPI condition family drift')
            count = 0
            for endpoint, item in spec['paths'].items():
                require(endpoint.startswith('/'), 'OpenAPI path must start with /')
                require(set(item) <= METHODS, 'Unsupported path item fields; extend checker before using')
                for method, op in item.items():
                    key = (method.upper(), endpoint); count += 1
                    require(key in routes and key not in operations, f'Invented/duplicate OpenAPI operation {key}')
                    operations[key] = op; source = routes[key]
                    require(source['host'] == host, f'{key}: wrong host')
                    require(op['x-source'] == source['source'] and op['x-handler'] == source['handler'], f'{key}: handler/source drift')
                    require(re.sub(r'\s+', '', op['x-java-return']) == source['return'], f'{key}: Java response type drift')
                    require(op['operationId'] not in ids, f'Duplicate operationId {op["operationId"]}'); ids.add(op['operationId'])
                    require({s for s in op['responses'] if s.startswith('2')} == {source['success']}, f'{key}: success status drift')
                    if host == 'ruoyi': require(op.get('x-ruoyi-permission') == source['permission'], f'{key}: native permission drift')
                    parameters = [self.resolve(p['$ref'], path)[0] if '$ref' in p else p for p in op.get('parameters', [])]
                    require(len({(p['in'], p['name']) for p in parameters}) == len(parameters), f'{key}: duplicate parameters')
                    path_parameters = {p['name'] for p in parameters if p['in'] == 'path' and p['required']}
                    require(path_parameters == set(re.findall(r'\{([^}]+)\}', endpoint)), f'{key}: path parameter mismatch')
                    for p in parameters: self.lint_schema(p['schema'], path)
                    clients = [p for p in parameters if p['name'] == 'X-Arcflow-Client']
                    if host == 'standalone' and method == 'post': require(len(clients) == 1 and clients[0]['required'] and clients[0]['schema'] == {'const': 'approval-demo'}, f'{key}: required client header drift')
                    elif host == 'ruoyi': require(not clients, f'{key}: invented native client header')
                    if method == 'post':
                        require(op.get('requestBody', {}).get('required') is True, f'{key}: required body missing')
                        for media in op['requestBody']['content'].values():
                            self.lint_schema(media['schema'], path)
                            for example in media.get('examples', {}).values():
                                require('externalValue' in example and 'value' not in example, 'Request example must reference reviewed executable file')
                                file = (path.parent / example['externalValue']).resolve()
                                require(file.parent == (self.root / 'docs/api/examples').resolve(), 'Request example must stay in reviewed examples directory')
                                self.validate(load_json(file, lexical=True), media['schema'], path, file.name)
                                self.domain_example(load_json(file, lexical=True), file.name)
                                self.examples.add(file.name)
                    for status, response in op['responses'].items():
                        require(status == 'default' or re.fullmatch('[1-5][0-9]{2}', status), f'{key}: invalid response status')
                        require(bool(response.get('description')), f'{key}: response description missing')
                        for media in response.get('content', {}).values(): self.lint_schema(media['schema'], path)
                    self.operation_contract(host, key, op, parameters, path)
            require(count == spec['x-controller-route-count'] == (21 if host == 'standalone' else 9), f'{host}: operation count drift')
        require(set(operations) == set(routes), 'OpenAPI omits actual controller handlers')
        files = {p.name for p in (self.root / 'docs/api/examples').glob('*.json')}
        require(len(files) == 12 and self.examples == files, 'Every one of the 12 request examples must be referenced and schema checked')
        manifest = load_json(self.root / SPEC_DIR / 'source-contract.json')
        require(manifest['formatVersion'] == 1, 'Unknown source review manifest format')
        require(set(manifest['sources']) == SOURCE_GUARDS, 'Source review guard inventory drift')
        for source, digest in manifest['sources'].items():
            require(source_digest(self.root / source) == digest, f'{source}: reviewed semantic source changed; review HTTP contract, schemas and tests before updating its digest')
        return f'PASS: 30 controller handlers; 2 OpenAPI 3.1 contracts; {len(schemas)} shared models; 9 types; 6 scenarios; 3 condition families; 12 schema-checked examples; {len(manifest["sources"])} source review guards.'

    def operation_contract(self, host, key, op, parameters, path):
        method, endpoint = key
        required_errors = {'403'} if host == 'ruoyi' else {'401', '403'}
        if method == 'POST': required_errors |= {'400', '409', '503'} | ({'415'} if host == 'standalone' else set())
        if endpoint.endswith('/inbox'): required_errors |= {'400', '503'}
        if endpoint.endswith('/decisions') or '/scenarios/' in endpoint or endpoint == '/api/crm/documents': required_errors.add('404')
        require(required_errors <= set(op['responses']), f'{key}: controlled error status missing')
        if endpoint.endswith('/inbox'):
            require({p['name'] for p in parameters if p['in'] == 'query'} == {'box', 'limit', 'status', 'processVersion', 'cursor'}, f'{key}: inbox query drift')
            require(op.get('x-reject-unknown-query-parameters') and op.get('x-reject-repeated-query-parameters'), f'{key}: strict inbox query policy missing')
        schema = op['responses']['201' if '201' in op['responses'] else '200']['content']['application/json']['schema']
        if host == 'ruoyi':
            require(set(schema.get('properties', {})) == {'code', 'msg', 'data'} and schema['properties']['code'] == {'type': 'integer', 'const': 200}, f'{key}: native envelope drift')
            schema = schema['properties']['data']
        expected = 'ScenarioTemplate' if endpoint == '/api/scenarios' else 'NativePerson' if endpoint == '/arcflow/me' else 'Person' if endpoint.endswith(('/me', '/people')) else 'ProcessDefinition' if '/scenarios/' in endpoint and endpoint.endswith('/process') else 'GenericProcessDefinition' if endpoint.endswith('/process') else 'QuoteVersion' if endpoint.endswith('/quotes') else 'InboxPage' if endpoint.endswith('/inbox') else 'ScenarioView' if '/scenarios/' in endpoint else 'QuoteView' if '/crm/' in endpoint else 'Request'
        is_list = method == 'GET' and (endpoint.endswith(('/people', '/quotes', '/requests')) or endpoint == '/api/scenarios')
        wanted = {'$ref': '#/components/schemas/' + expected}
        require(schema == ({'type': 'array', 'items': wanted} if is_list else wanted), f'{key}: response model/wrapper drift')
        if method == 'POST':
            expected_body = 'NativeDecision' if host == 'ruoyi' and endpoint.endswith('/decisions') else 'Decision' if endpoint.endswith('/decisions') else 'Publication' if '/scenarios/' in endpoint and endpoint.endswith('/process') else 'GenericPublication' if endpoint.endswith('/process') else 'LegacySubmission' if endpoint.endswith('/requests') else 'SealSubmission' if endpoint.endswith('/oa-seal-use/documents') else 'ScenarioSubmission' if '/scenarios/' in endpoint else 'QuoteSubmission' if '/crm/' in endpoint else 'GenericSubmission'
            require(op['requestBody']['content']['application/json']['schema'] == {'$ref': '#/components/schemas/' + expected_body}, f'{key}: request DTO/host type drift')
            expected_key = 'forbidden-header-quote-revision' if endpoint == '/api/crm/documents' else 'required-header' if '/scenarios/' in endpoint and endpoint.endswith('/documents') else 'optional-header' if endpoint.endswith(('/documents', '/requests')) else 'decision-replay' if endpoint.endswith('/decisions') else 'none'
            require(op.get('x-idempotency') == expected_key, f'{key}: idempotency policy drift')
            headers = [p for p in parameters if p['in'] == 'header' and p['name'] == 'Idempotency-Key']
            require(len(headers) == (1 if expected_key in ('required-header', 'optional-header') else 0), f'{key}: idempotency header presence drift')
            if headers: require(headers[0]['required'] == (expected_key == 'required-header'), f'{key}: required idempotency header drift')
        if endpoint == '/api/scenarios/oa-seal-use/documents':
            require(op.get('x-raw-utf16-limit') == 8000000 and op.get('x-raw-byte-precheck-limit') == 24000000, 'Seal raw-body limits drift')
        error = '#/components/schemas/' + ('NativeError' if host == 'ruoyi' else 'Error')
        for status, response in op['responses'].items():
            if status != 'default' and int(status) >= 400:
                require(response['content']['application/json']['schema'] == {'$ref': error}, f'{key}: controlled error envelope drift')

    def domain_example(self, body, where):
        """Cross-field checks for reviewed examples; runtime remains authoritative."""
        b = body.get('business')
        if b:
            if b.get('currency') == 'JPY':
                def whole(value):
                    if isinstance(value, dict):
                        for v in value.values(): whole(v)
                    elif isinstance(value, list):
                        for v in value: whole(v)
                    elif isinstance(value, Decimal): require(value == int(value), f'{where}: fractional JPY')
                whole(b)
            lines = b.get('lines', [])
            for field in ['lineId', 'receiptRef', 'invoiceRef', 'orderLineRef', 'milestoneRef']:
                values = [line[field] for line in lines if field in line]
                require(len(values) == len(set(values)), f'{where}: duplicate {field}')
            t = b['type']
            if t == 'quoteDiscount': require(b['requestedUnitPrice'] < b['listUnitPrice'], f'{where}: price must be discounted')
            if t == 'travel': require(1 <= (datetime.date.fromisoformat(b['endDate']) - datetime.date.fromisoformat(b['startDate'])).days + 1 <= 90, f'{where}: travel dates')
            if t == 'receiving':
                require(any(line['received'] > 0 for line in lines), f'{where}: no received quantity')
                for line in lines:
                    require(line['accepted'] + line['rejected'] == line['received'] <= line['ordered'], f'{where}: receiving reconciliation')
                    require(not line['rejected'] or fixed_scenario_nonblank(line['exceptionReason']), f'{where}: missing exception reason')
            if t == 'paymentRequest':
                for line in lines:
                    require(line['previouslySettledAmount'] <= line['invoiceAmount'] and line['allocationAmount'] <= line['invoiceAmount'] - line['previouslySettledAmount'] and line['deductionAmount'] <= line['allocationAmount'], f'{where}: payment reconciliation')
                    require(not line['deductionAmount'] or fixed_scenario_nonblank(line['deductionReason']), f'{where}: missing deduction reason')
                require(sum(line['allocationAmount'] - line['deductionAmount'] for line in lines) > 0, f'{where}: net total must be positive')
            if t == 'contractApproval':
                require(fixed_scenario_nonblank(b['deviationReason']) if b['termsKind'] == 'NONSTANDARD' else not java_trim(b['deviationReason']), f'{where}: deviation reason/terms mismatch')
                dates = [line['dueOn'] for line in lines]
                require(dates == sorted(dates) and all(b['startOn'] <= d <= b['endOn'] for d in dates), f'{where}: milestone dates')
                require(sum(line['amount'] for line in lines) == b['contractAmount'], f'{where}: milestone total')
        d = body.get('definition')
        if d:
            nodes = d['nodes']; interior = nodes[1:-1]
            require(nodes[0]['id'] == nodes[0]['type'] == 'start' and nodes[-1]['id'] == nodes[-1]['type'] == 'end', f'{where}: process boundaries')
            require(len({n['id'] for n in nodes}) == len(nodes), f'{where}: duplicate node IDs')
            require(all(n['id'] not in {'start', 'end'} and n['type'] not in {'start', 'end'} for n in interior), f'{where}: invalid interior stage')
            require(d['version'] == body['expectedVersion'], f'{where}: publication versions differ')
            if d['schemaVersion'] == 2: require(all(n['type'] == 'approval' for n in interior), f'{where}: group requires schema 3+')
            rules = [n['runIf'] for n in interior if 'runIf' in n]
            if rules:
                require(d['schemaVersion'] == 4 and len(rules) < len(interior), f'{where}: schema 4 and unconditional stage required')
                predicates = [p for rule in rules for p in rule['predicates']]
                require(len(predicates) <= 8 and len({p['field'] for p in predicates}) == 1, f'{where}: bounded single condition family required')
                require(len({p['currency'] for p in predicates if 'currency' in p}) <= 1, f'{where}: inconsistent condition currencies')
                require(all(p['threshold'] == int(p['threshold']) for p in predicates if p.get('currency') == 'JPY'), f'{where}: fractional JPY threshold')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT, help='Checkout root (also used by mutation tests)')
    args = parser.parse_args()
    try: print(Checker(args.root).check())
    except (ContractError, KeyError, TypeError, ValueError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr); return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
