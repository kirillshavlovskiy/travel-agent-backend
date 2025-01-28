"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.viatorClient = exports.ViatorService = void 0;
var axios_1 = require("axios");
var logger_js_1 = require("../utils/logger.js");
var ViatorService = /** @class */ (function () {
    function ViatorService() {
        this.apiKey = process.env.VIATOR_API_KEY || '24e35633-0018-48e9-b9b7-b2b36554ada3';
        this.baseUrl = 'https://api.viator.com/partner';
        this.searchCache = new Map();
    }
    ViatorService.prototype.getCacheKey = function (activityName, destinationId) {
        return "".concat(destinationId, ":").concat(activityName);
    };
    ViatorService.prototype.getDestinationId = function (cityName) {
        return __awaiter(this, void 0, void 0, function () {
            var response, destinations, destination, error_1, err;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        _e.trys.push([0, 2, , 3]);
                        return [4 /*yield*/, axios_1.default.post("".concat(this.baseUrl, "/v2/destinations/search"), {
                                query: cityName,
                                type: "CITY"
                            }, {
                                headers: {
                                    'Accept': 'application/json',
                                    'Content-Type': 'application/json',
                                    'Accept-Language': 'en-US',
                                    'Viator-API-Key': this.apiKey
                                }
                            })];
                    case 1:
                        response = _e.sent();
                        destinations = (_a = response.data) === null || _a === void 0 ? void 0 : _a.destinations;
                        if (!destinations || destinations.length === 0) {
                            throw new Error('No destinations found in response');
                        }
                        destination = destinations.find(function (dest) {
                            var _a, _b;
                            return dest.name.toLowerCase().includes(cityName.toLowerCase()) ||
                                ((_b = (_a = dest.parentDestination) === null || _a === void 0 ? void 0 : _a.name) === null || _b === void 0 ? void 0 : _b.toLowerCase().includes(cityName.toLowerCase()));
                        });
                        if (!destination) {
                            logger_js_1.logger.warn('[Viator] No matching destination found for:', cityName);
                            throw new Error("No destination found for ".concat(cityName));
                        }
                        logger_js_1.logger.info('[Viator] Found destination:', {
                            cityName: cityName,
                            destinationId: destination.destinationId,
                            name: destination.name,
                            parentName: (_b = destination.parentDestination) === null || _b === void 0 ? void 0 : _b.name
                        });
                        return [2 /*return*/, destination.destinationId];
                    case 2:
                        error_1 = _e.sent();
                        err = error_1;
                        logger_js_1.logger.error('[Viator] Destination lookup error:', {
                            cityName: cityName,
                            error: ((_c = err.response) === null || _c === void 0 ? void 0 : _c.data) || err.message,
                            status: (_d = err.response) === null || _d === void 0 ? void 0 : _d.status
                        });
                        throw error_1;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ViatorService.prototype.searchActivity = function (activityName, destinationId) {
        return __awaiter(this, void 0, void 0, function () {
            var cacheKey, cachedResult, startDate, endDate, searchRequest, response, error_2, err;
            var _a, _b, _c, _d, _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        _f.trys.push([0, 2, , 3]);
                        cacheKey = this.getCacheKey(activityName, destinationId);
                        cachedResult = this.searchCache.get(cacheKey);
                        if (cachedResult) {
                            logger_js_1.logger.debug('[Viator] Returning cached result for:', activityName);
                            return [2 /*return*/, cachedResult];
                        }
                        startDate = new Date();
                        endDate = new Date();
                        endDate.setDate(endDate.getDate() + 7);
                        searchRequest = {
                            text: activityName,
                            filtering: {
                                destination: destinationId
                            },
                            startDate: startDate.toISOString().split('T')[0],
                            endDate: endDate.toISOString().split('T')[0],
                            currency: "USD",
                            pagination: {
                                offset: 0,
                                limit: 3
                            },
                            sorting: {
                                sortBy: "RELEVANCE",
                                sortOrder: "DESC"
                            }
                        };
                        logger_js_1.logger.debug('[Viator] Searching for activity:', {
                            name: activityName,
                            destinationId: destinationId,
                            request: searchRequest
                        });
                        return [4 /*yield*/, axios_1.default.post("".concat(this.baseUrl, "/v1/products/search"), searchRequest, {
                                headers: {
                                    'Accept': 'application/json;version=2.0',
                                    'Content-Type': 'application/json',
                                    'Accept-Language': 'en-US',
                                    'Viator-API-Key': this.apiKey
                                }
                            })];
                    case 1:
                        response = _f.sent();
                        // Cache successful responses
                        if (((_c = (_b = (_a = response.data) === null || _a === void 0 ? void 0 : _a.products) === null || _b === void 0 ? void 0 : _b.results) === null || _c === void 0 ? void 0 : _c.length) > 0) {
                            this.searchCache.set(cacheKey, response.data);
                            logger_js_1.logger.debug('[Viator] Cached search results for:', {
                                activityName: activityName,
                                resultsCount: response.data.products.results.length
                            });
                        }
                        else {
                            logger_js_1.logger.warn('[Viator] No results found for activity:', {
                                activityName: activityName,
                                destinationId: destinationId
                            });
                        }
                        return [2 /*return*/, response.data];
                    case 2:
                        error_2 = _f.sent();
                        err = error_2;
                        logger_js_1.logger.error('[Viator] Search error:', {
                            activityName: activityName,
                            error: ((_d = err.response) === null || _d === void 0 ? void 0 : _d.data) || err.message,
                            status: (_e = err.response) === null || _e === void 0 ? void 0 : _e.status
                        });
                        throw error_2;
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ViatorService.prototype.enrichActivityDetails = function (activity) {
        return __awaiter(this, void 0, void 0, function () {
            var activityName, productCode, searchResponse, viatorActivity, similarity, bestImage, error_3, err;
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
            return __generator(this, function (_x) {
                switch (_x.label) {
                    case 0:
                        _x.trys.push([0, 2, , 3]);
                        activityName = activity.name;
                        productCode = (_b = (_a = activity.referenceUrl) === null || _a === void 0 ? void 0 : _a.match(/\-([a-zA-Z0-9]+)(?:\?|$)/)) === null || _b === void 0 ? void 0 : _b[1];
                        logger_js_1.logger.debug('[Viator] Enriching activity:', {
                            name: activityName,
                            productCode: productCode,
                            referenceUrl: activity.referenceUrl
                        });
                        return [4 /*yield*/, this.searchActivity(productCode ? "productCode:".concat(productCode) : activityName, '684')];
                    case 1:
                        searchResponse = _x.sent();
                        if (!((_d = (_c = searchResponse.products) === null || _c === void 0 ? void 0 : _c.results) === null || _d === void 0 ? void 0 : _d.length)) {
                            logger_js_1.logger.warn('[Viator] No matching products found:', {
                                name: activityName,
                                productCode: productCode
                            });
                            return [2 /*return*/, activity];
                        }
                        viatorActivity = searchResponse.products.results[0];
                        similarity = this.calculateSimilarity(activityName, viatorActivity.title);
                        logger_js_1.logger.debug('[Viator] Name similarity score:', {
                            original: activityName,
                            viator: viatorActivity.title,
                            score: similarity
                        });
                        // Only enrich if names are similar enough or product codes match
                        if (similarity < 0.3 && !productCode) {
                            logger_js_1.logger.warn('[Viator] Activity names too different:', {
                                original: activityName,
                                viator: viatorActivity.title,
                                similarity: similarity
                            });
                            return [2 /*return*/, activity];
                        }
                        logger_js_1.logger.debug('[Viator] Found matching activity:', {
                            originalName: activityName,
                            viatorName: viatorActivity.title,
                            productCode: viatorActivity.productCode
                        });
                        bestImage = (_g = (_f = (_e = viatorActivity.images) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.variants.sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); })[0]) === null || _g === void 0 ? void 0 : _g.url;
                        return [2 /*return*/, __assign(__assign({}, activity), { name: viatorActivity.title, description: viatorActivity.description, duration: ((_h = viatorActivity.duration) === null || _h === void 0 ? void 0 : _h.fixedDurationInMinutes) / 60 || activity.duration, price: {
                                    amount: ((_k = (_j = viatorActivity.pricing) === null || _j === void 0 ? void 0 : _j.summary) === null || _k === void 0 ? void 0 : _k.fromPrice) || activity.price.amount,
                                    currency: ((_l = viatorActivity.pricing) === null || _l === void 0 ? void 0 : _l.currency) || activity.price.currency
                                }, rating: ((_m = viatorActivity.reviews) === null || _m === void 0 ? void 0 : _m.combinedAverageRating) || activity.rating, numberOfReviews: ((_o = viatorActivity.reviews) === null || _o === void 0 ? void 0 : _o.totalReviews) || activity.numberOfReviews, images: bestImage ? [bestImage] : activity.images, provider: 'Viator', bookingInfo: {
                                    provider: 'Viator',
                                    productCode: viatorActivity.productCode,
                                    referenceUrl: viatorActivity.productUrl || "https://www.viator.com/tours/Berlin/".concat(viatorActivity.productCode),
                                    cancellationPolicy: ((_p = viatorActivity.bookingInfo) === null || _p === void 0 ? void 0 : _p.cancellationPolicy) || 'Free cancellation available',
                                    instantConfirmation: viatorActivity.confirmationType === 'INSTANT',
                                    mobileTicket: ((_q = viatorActivity.bookingInfo) === null || _q === void 0 ? void 0 : _q.mobileTicketing) || true,
                                    languages: ((_r = viatorActivity.bookingInfo) === null || _r === void 0 ? void 0 : _r.languages) || ['English'],
                                    minParticipants: ((_s = viatorActivity.bookingInfo) === null || _s === void 0 ? void 0 : _s.minParticipants) || 1,
                                    maxParticipants: ((_t = viatorActivity.bookingInfo) === null || _t === void 0 ? void 0 : _t.maxParticipants) || 999,
                                    location: ((_u = viatorActivity.location) === null || _u === void 0 ? void 0 : _u.address) || ((_v = viatorActivity.location) === null || _v === void 0 ? void 0 : _v.meetingPoint),
                                    highlights: viatorActivity.highlights || []
                                } })];
                    case 2:
                        error_3 = _x.sent();
                        err = error_3;
                        logger_js_1.logger.error('[Viator] Enrichment error:', {
                            activityName: activity.name,
                            error: ((_w = err.response) === null || _w === void 0 ? void 0 : _w.data) || err.message
                        });
                        return [2 /*return*/, activity];
                    case 3: return [2 /*return*/];
                }
            });
        });
    };
    ViatorService.prototype.calculateSimilarity = function (str1, str2) {
        // Convert both strings to lowercase and remove special characters
        var clean1 = str1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        var clean2 = str2.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        // Split into words
        var words1 = new Set(clean1.split(/\s+/));
        var words2 = new Set(clean2.split(/\s+/));
        // Calculate intersection
        var intersection = new Set(__spreadArray([], words1, true).filter(function (x) { return words2.has(x); }));
        // Calculate Jaccard similarity
        var similarity = intersection.size / (words1.size + words2.size - intersection.size);
        return similarity;
    };
    return ViatorService;
}());
exports.ViatorService = ViatorService;
// Create and export a singleton instance
exports.viatorClient = new ViatorService();
