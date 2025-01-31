"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
var viator_js_1 = require("../services/viator.js");
var logger_js_1 = require("../utils/logger.js");
function testViatorSearch() {
    return __awaiter(this, void 0, void 0, function () {
        var cityName, destinationId, activityName, searchResult, activity, error_1;
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        return __generator(this, function (_k) {
            switch (_k.label) {
                case 0:
                    _k.trys.push([0, 3, , 4]);
                    cityName = 'Barcelona';
                    logger_js_1.logger.info('Looking up destination ID for:', cityName);
                    return [4 /*yield*/, viator_js_1.viatorClient.getDestinationId(cityName)];
                case 1:
                    destinationId = _k.sent();
                    logger_js_1.logger.info('Found destination ID:', destinationId);
                    activityName = 'East to West Route';
                    logger_js_1.logger.info('Searching for activity:', activityName);
                    return [4 /*yield*/, viator_js_1.viatorClient.searchActivity(activityName, destinationId)];
                case 2:
                    searchResult = _k.sent();
                    // Step 3: Log the results
                    if (((_b = (_a = searchResult.products) === null || _a === void 0 ? void 0 : _a.results) === null || _b === void 0 ? void 0 : _b.length) > 0) {
                        activity = searchResult.products.results[0];
                        logger_js_1.logger.info('Found activity:', {
                            title: activity.title,
                            productCode: activity.productCode,
                            description: activity.description,
                            duration: (_c = activity.duration) === null || _c === void 0 ? void 0 : _c.fixedDurationInMinutes,
                            price: (_e = (_d = activity.pricing) === null || _d === void 0 ? void 0 : _d.summary) === null || _e === void 0 ? void 0 : _e.fromPrice,
                            currency: (_f = activity.pricing) === null || _f === void 0 ? void 0 : _f.currency,
                            rating: (_g = activity.reviews) === null || _g === void 0 ? void 0 : _g.combinedAverageRating,
                            reviewCount: (_h = activity.reviews) === null || _h === void 0 ? void 0 : _h.totalReviews,
                            bookingInfo: activity.bookingInfo,
                            images: (_j = activity.images) === null || _j === void 0 ? void 0 : _j.map(function (img) { var _a; return (_a = img.variants[0]) === null || _a === void 0 ? void 0 : _a.url; }),
                            highlights: activity.highlights,
                            location: activity.location
                        });
                    }
                    else {
                        logger_js_1.logger.warn('No results found for activity:', activityName);
                    }
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _k.sent();
                    logger_js_1.logger.error('Test failed:', error_1);
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    });
}
// Run the test
testViatorSearch();
